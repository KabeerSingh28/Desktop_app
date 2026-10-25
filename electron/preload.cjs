const {contextBridge , ipcRenderer} = require("electron")
//giving it custom api name(electronAPI)
contextBridge.exposeInMainWorld('electronAPI',{
    save : (value) => ipcRenderer.send('save-event',value),
    delete : (value) => ipcRenderer.send('delete-event',value),
    update : (value) => ipcRenderer.send('update-event',value),
    create : (value) => ipcRenderer.send('create-event',value),
    setFullScreen : () => ipcRenderer.send('set-fullScreen'),
    getData : (value) => ipcRenderer.invoke('get-data',value),
    showExamRules : () => ipcRenderer.send('show-exam-rules')
})