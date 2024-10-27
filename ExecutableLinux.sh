sed -i 's/\(mainWindow.webContents.openDevTools.*\)/\/\/\1/g'   app.js 
electron-packager . getimage  --platform "linux"  --arch x64 --out dist_img/ \
--overwrite --asar --icon='logo512.png' --prune=true  --version-string.CompanyName=CE \
--version-string.FileDescription=CE --version-string.ProductName='Get Image'
sed -i 's/\/\/\(mainWindow.webContents.openDevTools.*\)/\1/g'   app.js 