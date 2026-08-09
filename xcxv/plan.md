# Implementation plan — `xcxv/spewc.md`

Authoritative contract for backend-coder and frontend-coder. Build against the names in
this document; they are fixed. All paths are absolute under
`C:\Users\maria\prj\electron\distribute-1\`.

---

## 0. Hard constraints (read before touching anything)

**C1 — The `items` table is FROZEN. Do not add, rename, or remove columns.**
`compareImg/dbImport.js:29-36` validates an imported database by comparing
`pragma("table_info(items)")` column sets against the live schema. Any new column on
`items` makes every previously exported `.db` fail to import with
*"Database structure differs from the actual index"*. New **tables** and new **indexes**
on `items` are safe — `table_info` reports columns only.

**C2 — Every new IPC channel must be registered in `preload.js`.**
`preload.js:5-68` is a real allowlist. Renderer→main channels go in `ipc.render.send`;
channels the renderer listens on via `ipcRender.on(...)` go in `ipc.render.sendReceive`
(that is the list `on`/`once` validate against). An unregistered channel is silently
dropped with no error.

**C3 — `onImages` REPLACES the grid; it may be called only once per load.**
`app.js:397` wires `onImages` to the `directoryOpen` channel, which dispatches
`populateArray` (`src/lib/redux/slices/media/media.reduce.ts:30-33`) — that assigns
`medias`, it does not append. A second `onImages` call would wipe the first batch.
See §5 for how the cached-video fast path works within this constraint.

**C4 — The media `id` stays path-derived.** `hashFor(absolutePath)` remains the media id
everywhere (grid key, `items.actualPosition`, duplicate groups, detection results).
File-content MD5 is a **new, separate** value called `contentMd5`. Rationale in §2.

**C5 — Never string-concatenate values into SQL.** The only permitted interpolation is a
`?`-placeholder list built from an array's *length* (§5).

---

## 1. Database schema

One SQLite file, unchanged location: `<openedFolder>/tmp/hashIndex/index.db`
(`compareImg/cache.js`). New tables are created by the same
`CREATE TABLE IF NOT EXISTS` + `ensureColumn` additive style already in
`compareImg/HashStore.js:25-50`. Nothing is ever dropped.

### New file: `mediaDb/mediaSchema.js`

Holds DDL only, requires nothing. This avoids a require cycle:
`HashStore` → `mediaSchema`, and `MediaStore` → `HashStore`.

```sql
-- (a) media metadata — one row per media FILE
CREATE TABLE IF NOT EXISTS media (
    id          TEXT PRIMARY KEY,             -- md5 of the absolute path; == items.actualPosition
    localPath   TEXT NOT NULL,
    filename    TEXT NOT NULL,                -- path.basename(localPath)
    mime        TEXT,
    kind        TEXT NOT NULL,                -- 'image' | 'gif' | 'video'
    size        INTEGER NOT NULL DEFAULT 0,
    mtimeMs     REAL    NOT NULL DEFAULT 0,   -- invalidates contentMd5/thumb when the file changes
    contentMd5  TEXT,                         -- md5 of the FILE BYTES; NULL until hashed
    hasAudio    INTEGER NOT NULL DEFAULT 0,   -- 0/1
    thumbPath   TEXT,                         -- last known thumbnail on disk; NULL for plain images
    updatedAt   INTEGER NOT NULL DEFAULT 0    -- Date.now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_localPath  ON media(localPath);
CREATE INDEX        IF NOT EXISTS idx_media_contentMd5 ON media(contentMd5);

-- (b) media -> duplication rows: 1:N. NO NEW TABLE AND NO DDL CHANGE.
-- The relation already exists: mediaIndexer.js:38,71 writes the media id into
-- items.actualPosition. An image contributes 1 items row; a video/gif contributes
-- one per extracted frame (videoFrames.FRAME_POSITIONS => 4). Only add the index
-- that makes the join fast. Index-only => C1 is respected.
CREATE INDEX IF NOT EXISTS idx_items_actualPosition ON items(actualPosition);

-- (c) detection class names — array index IS the class id
CREATE TABLE IF NOT EXISTS detection_class (
    classId   INTEGER PRIMARY KEY,            -- 0-based position in the comma-split string
    name      TEXT NOT NULL,
    updatedAt INTEGER NOT NULL DEFAULT 0
);

-- (d) detection results — N rows per media
CREATE TABLE IF NOT EXISTS media_detection (
    mediaId    TEXT    NOT NULL,              -- logical FK -> media.id (see note below)
    classId    INTEGER NOT NULL,
    className  TEXT    NOT NULL,              -- denormalised: survives a later class-list edit
    score      REAL    NOT NULL,              -- 0..1; the UI percentage is score * 100
    x          REAL    NOT NULL,
    y          REAL    NOT NULL,
    w          REAL    NOT NULL,
    h          REAL    NOT NULL,
    modelPath  TEXT,                          -- which .onnx produced this
    detectedAt INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_media_detection_mediaId ON media_detection(mediaId);
CREATE INDEX IF NOT EXISTS idx_media_detection_classId ON media_detection(classId);
```

**Why `media_detection.mediaId` is not a declared `REFERENCES`:** better-sqlite3 enables
`PRAGMA foreign_keys = ON`, and detection also runs over the transient
`{ imported: true }` items from `compareImg/dbImport.js`, which have no `media` row. A
hard FK would make those inserts throw at runtime. The relation is enforced by the
writer plus the index instead.

**Why `x/y/w/h` are stored:** `objectDetection/onnxDetector.js:123-131` already produces
them and `objectDetectionGrid.tsx:61` needs them to draw the overlay. Persisting only
class+score would make the stored results unrenderable.

### `compareImg/HashStore.js` — additions

- `require("../mediaDb/mediaSchema")` and call `createMediaSchema(database)` at the end
  of `createSchema` (`HashStore.js:32-50`), so both the fresh-create and the
  already-exists paths converge.
- Export `getDb()`: `ensureReady(); return db;` — the single shared connection.
  Do **not** let `MediaStore` open a second `new Database(...)` on the same file.
- **`rebuildIndex()` must preserve `detection_class`.** Class names are user-typed
  configuration, not derived data; wiping them on an index rebuild is silent data loss.
  Read them (inside `try/catch`, so a corrupt db still rebuilds), delete the file,
  recreate the schema, re-insert.

### New file: `mediaDb/MediaStore.js`

All queries use the shared `HashStore.getDb()`.

```js
ensureReady()                                  // delegates to HashStore.ensureReady()

// media
findMediaByIds(ids)        -> Map<string, row> // batched; see §5 for the exact SQL
upsertMedia(row)                               // INSERT ... ON CONFLICT(id) DO UPDATE
setContentMd5(id, contentMd5)
mediaMissingContentMd5(limit) -> row[]         // SELECT ... WHERE contentMd5 IS NULL LIMIT ?

// detection classes
getDetectionClasses()      -> string[]         // ORDER BY classId ASC
saveDetectionClasses(names)                    // one transaction: DELETE FROM detection_class,
                                               // then INSERT one row per array index

// detection results
replaceDetections(mediaId, boxes, modelPath)   // one transaction:
                                               // DELETE FROM media_detection WHERE mediaId = ?,
                                               // then insert every box
getDetections(mediaId)     -> box[]
```

---

## 2. File-content MD5

### New file: `hashing/fileHash.js`

```js
fileMd5(filePath)     -> Promise<string|null>  // streamed, 1 MiB chunks; null on read error
fileMd5Sync(filePath) -> string|null           // chunked fs.readSync loop
```

`fileMd5` MUST use `fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })` piped
into `crypto.createHash("md5")`. **Never `fs.readFileSync`** — video files are gigabytes.
`fileMd5Sync` must likewise loop `fs.readSync` over an `fs.openSync` handle with a reused
1 MiB buffer, not slurp the file. Both resolve/return `null` rather than throwing, so a
locked or deleted file degrades to the path-hash fallback instead of failing the load.

Add a small local concurrency limiter (`FILE_HASH_CONCURRENCY = 4`) inside this module —
do not refactor the semaphore out of `compareImg/videoFrames.js:78-96`.

### Where content MD5 is used, and where it is NOT

| Consumer | Value used | Reason |
|---|---|---|
| grid / `Media.id` / `FileDTO.id` | `hashFor(path)` — **unchanged** | see C4 below |
| `items.id`, `items.actualPosition` | `hashFor(path)` — **unchanged** | existing index.db keeps working |
| `media.contentMd5` column | `fileMd5` | content identity |
| thumbnail cache filename | `contentMd5`, path hash as fallback | identical media share one thumbnail |
| `compareImg/videoFrames.js:65` frame filenames | `hashFor(path)` — **unchanged** | frames are per-source-file; out of scope |

**C4 rationale (do not "simplify" this away).** Making the renderer `id` equal the
content MD5 collapses byte-identical files into one grid tile:
`media.reduce.ts:16-23` dedupes by `id` and `updateArrayItem` matches by `id`. In a
duplicate-finder app the user would lose the ability to see or select the copy. It would
additionally orphan every row in every existing `index.db`, and would force a full read
of a multi-GB video just to compute its thumbnail path — which is exactly what §5 exists
to avoid.

### `thumbnails/cache.js`

```js
hashFor(videoPath)                            // UNCHANGED — md5 of the path string
thumbnailPathFor(videoPath, contentMd5)       // <cacheDir>/<contentMd5 || hashFor(videoPath)>.jpeg
legacyThumbnailPathFor(videoPath)             // <cacheDir>/<hashFor(videoPath)>.jpeg
```

`contentMd5` is an **optional second argument**, so all existing call sites keep working
unchanged while the value is still unknown.

### `thumbnails/ThumbnailService.js`

`getThumbnail(videoPath, contentMd5)` / `getThumbnailSync(videoPath, contentMd5)` — new
optional second argument, threaded into `cache.thumbnailPathFor`. Insert one step before
generating, after the existing `fs.existsSync(output)` short-circuit
(`ThumbnailService.js:54-55, 70-71`):

```
if contentMd5 is set and output does not exist and legacyThumbnailPathFor(videoPath) exists:
    fs.renameSync(legacy, output)   // adopt
    return output
```

This one mechanism does two jobs: it migrates every already-cached thumbnail from the old
path-hash name (so upgrading users do not regenerate their whole library), and it
re-homes a thumbnail generated before the background backfill learned the file's
`contentMd5`. Wrap the rename in `try/catch` — an adoption failure must fall through to
normal generation, never break the load.

`linkPathFor` (`ThumbnailService.js:20`) keeps using `cache.hashFor` — it names a
temporary hard link, not a cache entry.

### Content hashing must never block the load path

`transformDataStreaming` reads `contentMd5` from the `media` table (a single indexed
query, §5) and passes it through. It does **not** hash files inline. A background pass
started after `onDone()` fills in the gaps:

```js
// mediaDb/MediaStore.js or a small mediaDb/backfill.js
backfillContentMd5()   // loops mediaMissingContentMd5(...) in batches,
                       // fileMd5() at FILE_HASH_CONCURRENCY, setContentMd5()
```

Net cost: every file is hashed exactly once, ever, off the critical path. Subsequent
loads read the memoised value out of SQLite and touch no file bytes.

---

## 3. GIF thumbnails at 90%

**`thumbnails/providers/ffmpegStatic.js` needs NO change. Verified, not assumed:**

- `getDuration` (line 16-23) runs `ffmpeg -i <input>` and regex-matches the
  `Duration: HH:MM:SS.ms` line off stderr. ffmpeg emits that line for GIF inputs.
- `argsFor` (line 39-46) is codec-agnostic: `-ss <seek> -i <in> -frames:v 1
  -vf thumbnail,scale=300:-2 <out.jpeg>`. The `.jpeg` extension selects mjpeg regardless
  of input format.
- `generate` (line 63-70) already retries with `seek = 0` when the 90% seek produces no
  frame, which covers short or duration-less GIFs.

No new function, no new parameter. **The only change is routing** — GIFs must be sent
down the thumbnail path instead of being emitted as plain images. That happens in
`util.js` (§5) and `compareImg/mediaIndexer.js`.

Consequences to implement deliberately:

- `FileDTO.fileName` for a GIF becomes the thumbnail `.jpeg`, so `Media.media` is the
  static thumbnail and the grid shows a still frame. `Media.path` still points at the
  original `.gif`, so `modalZoom.tsx` keeps playing the animation on preview. This is
  exactly what the spec asks for.
- `Media.mime` stays `image/gif`. Do not change it. `matchesMediaType`
  (`src/components/mediaTypeFilter.tsx:11-16`) and the badge both key off
  `mime.includes('gif')`.
- `compareImg/mediaIndexer.js:97-101` routes on `mime.includes("video")` / `"image"`.
  Add a gif branch **before** the image branch so a GIF goes through `indexVideo` and
  contributes N frame rows — that is the "gif has many records" half of spec item 1.
  `videoFrames.hasAudio` on a GIF simply returns false.

---

## 4. Detection class names — IPC contract

Frontend and backend build against this table independently. Nothing else is shared.

### Channels (register all three in `preload.js`, see C2)

| Channel | Direction | preload list | Payload |
|---|---|---|---|
| `saveDetectionClasses` | renderer → main | `ipc.render.send` | `{ classes: string }` — the **raw** comma-separated string, exactly as typed |
| `loadDetectionClasses` | renderer → main | `ipc.render.send` | `undefined` |
| `detectionClassesLoaded` | main → renderer | `ipc.render.sendReceive` | `{ names: string[], error?: string }` |

**The main process owns the split.** It is the single authoritative parse:
`String(classes).split(",").map(s => s.trim()).filter(s => s.length > 0)`. The renderer
sends the raw string and never splits. `detectionClassesLoaded` is the reply to **both**
requests — after a save, main replies with the array it actually persisted, so the UI can
never drift from the database.

Array index is the class id: index 0 → class 0. Empty entries are dropped, which shifts
subsequent ids; that is the documented behaviour of "split by comma".

### Backend wiring

- `app.js` — two handlers next to the existing `chooseOnnxModel` (`app.js:234`):
  ```js
  ipcMain.on("saveDetectionClasses", (event, data) => { /* split, saveDetectionClasses,
      onnxDetector.setClassNames(names), send detectionClassesLoaded */ })
  ipcMain.on("loadDetectionClasses", () => { /* getDetectionClasses,
      onnxDetector.setClassNames(names), send detectionClassesLoaded */ })
  ```
  Both wrapped in `try/catch`, replying `{ names: [], error: err.message }` on failure.
- `objectDetection/onnxDetector.js` — replace `const CLASS_NAMES = [];` (line 17) with a
  module-level `let classNames = [];` plus `setClassNames(names)` / `getClassNames()`.
  `classNameFor` (line 19) reads `classNames`, keeping its `class ${classId}` fallback.
  Drop `CLASS_NAMES` from the exports at line 146 — it has no other consumer (verified by
  grep across the repo).

**Known scope note, not a bug to fix here:** `index.db` lives inside the opened folder,
so the class list is per-folder. The renderer must therefore re-request
`loadDetectionClasses` whenever a folder finishes loading, not only on mount.

### Frontend wiring

- `src/lib/redux/slices/detections/detections.reduce.ts` — add `classNames: string[]` to
  `DetectionsState` (initial `[]`) and a reducer
  `setDetectionClasses: (state, action) => ({ ...state, classNames: action.payload })`.
  Export it alongside the existing actions on line 69.
- `src/lib/redux/slices/detections/selectors.ts` — add
  `export const selectDetectionClassNames = (state: ReduxState) => state.detections.classNames;`
- `src/lib/redux/slices/detections/electron.action.ts` — two thunks matching the existing
  `StopDetection` shape (lines 46-57):
  ```ts
  export const SaveDetectionClasses = (classes: string) => ...  // send('saveDetectionClasses', { classes })
  export const LoadDetectionClasses = () => ...                 // send('loadDetectionClasses', undefined)
  ```
- `src/lib/redux/slices/media/electron.action.ts` — add `'detectionClassesLoaded'` to the
  `channels` array (line 27) so the listener is torn down on reconnect, then register it
  next to `onnxModelChosen` (line 106):
  ```ts
  ipcRender.on('detectionClassesLoaded', (e: any, r: { names: string[] }) =>
      dispatch(setDetectionClasses(r.names)))
  ```
  Import `setDetectionClasses` from `'../detections'` on line 7.

---

## 5. Cached-thumbnail fast path in `transformDataStreaming`

`util.js:18-50`. Today every video serially awaits its own thumbnail generation and audio
probe before its single `onVideo` IPC round-trip — that is the slow second load.

### The batched lookup (exact SQL)

```js
// MediaStore.findMediaByIds
const CHUNK = 400;   // SQLite's default SQLITE_MAX_VARIABLE_NUMBER is 999
// per chunk:
const placeholders = chunk.map(() => "?").join(",");
const rows = db.prepare(
    `SELECT id, localPath, contentMd5, size, mtimeMs, hasAudio, thumbPath
       FROM media
      WHERE id IN (${placeholders})`
).all(...chunk);
```

`${placeholders}` is the **only** interpolation, and it is derived purely from
`chunk.length` — no caller value ever reaches the SQL text (C5). Every id is bound.
Returns a `Map<id, row>`.

### New flow

1. Build `withMeta` as today, plus two new fields: `mtimeMs` (from the `fs.statSync` call
   already being made — reuse one `statSync` result instead of calling it three times as
   lines 22/28 currently do) and `kind` (`'gif' | 'video' | 'image'`).
2. Split three ways instead of two:
   - `images` — `mime.includes('image') && !mime.includes('gif')`
   - `framed` — `mime.includes('video') || mime.includes('gif')`
3. `MediaStore.ensureReady()`, then
   `const cached = MediaStore.findMediaByIds(framed.map(i => i.id))`.
   **Wrap steps 3-4 in `try/catch`; on any DB error fall through to the current slow path
   for everything.** A broken index must never stop the folder from opening.
4. Partition `framed` into `ready` / `pending`. An item is `ready` only when **all** hold:
   - a row exists for its id, and
   - `row.size === item.size` **and** `row.mtimeMs === item.mtimeMs` (the file has not
     been replaced under the same path), and
   - `row.contentMd5` is set, and
   - `fs.existsSync(cache.thumbnailPathFor(item.item, row.contentMd5))`.

   For a `ready` item set `item.fileName = <that thumbnail path>`,
   `item.hasAudio = Boolean(row.hasAudio)`, `item.contentMd5 = row.contentMd5`.
5. **`onImages(images.concat(ready))` — exactly one call.** See C3: `onImages` maps to
   `populateArray`, which replaces the array; calling it twice would discard the first
   batch. Deferring it behind one indexed SQL query costs microseconds.
6. Loop only `pending` through the existing slow path — `getThumbnail(item.item,
   row?.contentMd5)`, `videoFrames.hasAudio`, then `onVideo(item)` — and
   `MediaStore.upsertMedia(...)` each one as it completes.
7. `upsertMedia` for the `images` too (so they get `media` rows and become eligible for
   the content-MD5 backfill), then `onDone()`, then kick off `backfillContentMd5()`
   without awaiting it.

`transformFixedData` (`util.js:52-82`) gets the same gif-goes-through-thumbnails routing
using `getThumbnailSync`, but **no** DB fast path — it is the synchronous
`FixFiles`/recursive-load path and is not the reported bottleneck.

**Pre-existing issue, flag only, do not fix here:** `setActiveFolder` is called from the
`open` (`app.js:184`) and `openRecursive` (`app.js:463`) handlers but not on the
`verifyOpen` startup path (`app.js:327-339`) when `fileGlobal` came from `process.argv`.
In that case `getTmpRoot()` falls back to `cwd`/`os.tmpdir()`, so the fast path reads a
different database than the one the folder actually owns. It degrades to the slow path
(cache misses), so it is not a correctness break — but it means the argv startup path
never gets the speedup.

---

## 6. Model title and button gating

Already implemented by frontend-coder in the working tree; listed for completeness:

- `src/components/objectDetectionGrid.tsx:38` — Stop is now
  `disabled={!detecting || !modelPath}`.
- `src/components/objectDetectionGrid.tsx:42` — model span now carries
  `title={modelPath ?? undefined}`.

---

## BACKEND — file-by-file

| # | File | Work |
|---|---|---|
| B1 | `hashing/fileHash.js` **(new)** | `fileMd5` (stream, 1 MiB chunks) + `fileMd5Sync` (chunked `readSync` loop) + `FILE_HASH_CONCURRENCY = 4` limiter. Return `null` on error, never throw. Never `readFileSync`. §2 |
| B2 | `mediaDb/mediaSchema.js` **(new)** | `createMediaSchema(database)` — the four DDL blocks in §1 verbatim. Requires nothing (cycle-free). |
| B3 | `compareImg/HashStore.js` | Call `createMediaSchema(database)` from `createSchema` (line 32-50). Export `getDb()`. Make `rebuildIndex` (line 59-64) preserve `detection_class` across the wipe, inside `try/catch`. **Do not touch the `items` columns** (C1). |
| B4 | `mediaDb/MediaStore.js` **(new)** | The API in §1, all on `HashStore.getDb()`. `findMediaByIds` uses the chunked placeholder query from §5. `saveDetectionClasses` and `replaceDetections` each run in one `db.transaction`. |
| B5 | `mediaDb/backfill.js` **(new, or fold into B4)** | `backfillContentMd5()` — batch `mediaMissingContentMd5`, `fileMd5` at concurrency 4, `setContentMd5`. Fire-and-forget; log and continue on per-file failure. §2 |
| B6 | `thumbnails/cache.js` | `thumbnailPathFor(videoPath, contentMd5)` optional 2nd arg; add `legacyThumbnailPathFor`. `hashFor` unchanged. §2 |
| B7 | `thumbnails/ThumbnailService.js` | `getThumbnail`/`getThumbnailSync` take optional `contentMd5`; add the legacy-thumbnail adoption rename before generating, in `try/catch`. §2 |
| B8 | `thumbnails/providers/ffmpegStatic.js` | **No change.** Verified to already handle GIF. §3 |
| B9 | `util.js` | Rewrite `transformDataStreaming` per §5: single `statSync`, `mtimeMs` + `kind` + `contentMd5` fields, three-way split, batched `findMediaByIds`, one `onImages(images.concat(ready))` call, slow loop for `pending` only, `upsertMedia` throughout, `backfillContentMd5()` after `onDone`. Whole DB section in `try/catch` falling back to today's behaviour. Also route gif through `getThumbnailSync` in `transformFixedData`. |
| B10 | `compareImg/mediaIndexer.js` | Add a gif branch before the image branch at line 97-101 so gifs go through `indexVideo` (N frame rows). §1(b), §3 |
| B11 | `objectDetection/onnxDetector.js` | `const CLASS_NAMES = []` (line 17) → `let classNames = []` + `setClassNames`/`getClassNames`; `classNameFor` reads it; drop `CLASS_NAMES` from exports (line 146). §4 |
| B12 | `app.js` | Add `saveDetectionClasses` / `loadDetectionClasses` handlers (§4). In the `detectObjects` loop (line 258-269) call `MediaStore.replaceDetections(media.id, boxes, onnxDetector.getModelPath())` after each successful detect, inside `try/catch` so a DB failure never aborts detection. |
| B13 | `preload.js` | Add `saveDetectionClasses` + `loadDetectionClasses` to `ipc.render.send`; add `detectionClassesLoaded` to `ipc.render.sendReceive`. **C2 — without this the feature silently does nothing.** |

Verification for backend: `npm run build` must pass, then open a folder twice and confirm
the second open sends videos through `onImages` (add a temporary count log) and that
`compareImg/dbImport.js`'s import still accepts a `.db` exported before these changes.

## FRONTEND — file-by-file

| # | File | Work |
|---|---|---|
| F1 | `src/components/media.styled.tsx` | **Done** — `isGif` prop, `darkgreen` background. |
| F2 | `src/components/media.tsx` | **Done** — `"G"` badge for `mime.includes('gif')`. |
| F3 | `src/components/objectDetectionGrid.tsx` | **Done** — Stop gated on `!modelPath`, model span `title={modelPath}`. |
| F4 | `src/lib/redux/slices/detections/detections.reduce.ts` | Add `classNames: string[]` to `DetectionsState` (initial `[]`) + `setDetectionClasses` reducer; export it. §4 |
| F5 | `src/lib/redux/slices/detections/selectors.ts` | Add `selectDetectionClassNames`. §4 |
| F6 | `src/lib/redux/slices/detections/electron.action.ts` | Add `SaveDetectionClasses(classes: string)` and `LoadDetectionClasses()`, same guard shape as `StopDetection` (lines 46-57). Send the **raw** string — do not split in the renderer. §4 |
| F7 | `src/lib/redux/slices/media/electron.action.ts` | Add `'detectionClassesLoaded'` to the `channels` array (line 27); register the listener next to `onnxModelChosen` (line 106) dispatching `setDetectionClasses(r.names)`; import it from `'../detections'` (line 7). §4 |
| F8 | `src/components/objectDetectionGrid.tsx` | Add a class-list `IconButton` (suggest `@mui/icons-material`'s `Label` or `FormatListNumbered`) in the `DetectionResume` toolbar, opening a MUI `Dialog`. Copy the form-submit pattern from `src/components/folder.tsx:187-224`: `PaperProps={{ component: 'form', onSubmit }}`, a single multiline `TextField name="classes"` prefilled with `classNames.join(', ')`, Cancel + Save. On submit dispatch `SaveDetectionClasses(formJson.classes)` and close. Also dispatch `LoadDetectionClasses()` from a mount `useEffect` **and** when media finish loading, since `index.db` is per-folder (§4). |

Verification for frontend: `npm run build`, then in the running app type
`person, car, dog`, reopen the dialog and confirm it comes back prefilled from the
database round-trip (not from local component state), and that detection labels render
those names instead of `class 0`.

---

## Ordering

F4-F7 and B13 are the shared seam. Once B13 (`preload.js`) and F4-F7 (redux) are in, the
two tracks are independent: the frontend can build the dialog against
`detectionClassesLoaded` while the backend builds persistence behind it. Everything else
in BACKEND is self-contained.
