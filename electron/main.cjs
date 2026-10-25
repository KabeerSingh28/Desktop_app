const { BrowserWindow, app, ipcMain } = require("electron");
const path = require("path")
let pathToFile = path.join(__dirname,"preload.cjs")

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences : {
    preload : pathToFile
    }
  });

  win.loadURL("http://localhost:5173/");
  // win.webContents.openDevTools({ mode: "detach" });
  ipcMain.on('save-event',(event , data) => {//first parameter is event
    console.log(data, "Data Saved")
  })
    ipcMain.on('delete-event',(event , data) => {
    console.log(data, "Data Deleted")
  })
    ipcMain.on('update-event',(event , data) => {//fire and forget : send-on
    console.log(data, "Data Updated")
  })
    ipcMain.on('create-event',(event , data) => {
    console.log(data, "Data Created")
  })
  ipcMain.on('set-fullScreen',(event) => {
    win.setFullScreen(true)
  })
  ipcMain.handle('get-data', async(event,data) => {//req and res : handle-invoke
    return data;
  })

ipcMain.handle('show-exam-rules', async () => {
  const res=await dialog.showMessageBox(window,)
});



}

app.whenReady().then(() => {
  createWindow();
});
