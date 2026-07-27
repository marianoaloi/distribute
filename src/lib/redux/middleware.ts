import { createLogger } from 'redux-logger'
import { mediasApi } from "./slices/media/media.reduce";
import { setPage, setPostsPerPage, setScrollPosition } from "./slices/configurations";
import { savePersistedConfig } from "./slices/configurations/persistConfig";

const PERSISTED_ACTION_TYPES: string[] = [setPage.type, setPostsPerPage.type, setScrollPosition.type];

// Writes postsPerPage/page/scrollPosition to localStorage whenever one of
// them changes, so the grid restores where the user left off on next launch.
// store/next/action are untyped here (matching this file's existing "middleware
// as any" pattern in store.ts) to avoid a circular type reference: ReduxState
// is derived from reduxStore, which is configured with this middleware array.
const persistConfigMiddleware = (store: any) => (next: any) => (action: any) => {
    const result = next(action);
    if (PERSISTED_ACTION_TYPES.includes(action.type)) {
        const { postsPerPage, page, scrollPosition } = store.getState().configuration;
        savePersistedConfig({ postsPerPage, page, scrollPosition });
    }
    return result;
};

const middleware = [
    persistConfigMiddleware,
    createLogger({
        duration: true,
        timestamp: false,
        collapsed: true,
        colors: {
            title: () => '#139BFE',
            prevState: () => '#1C5FAF',
            action: () => '#149945',
            nextState: () => '#A47104',
            error: () => '#ff0005',
        },
        predicate: () => typeof window !== 'undefined',
    }),
    mediasApi.middleware
]

export { middleware }