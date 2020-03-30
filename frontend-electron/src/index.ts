import { app, BrowserWindow, ipcMain } from 'electron';
import { v4 as uuid } from "uuid";
declare const MAIN_WINDOW_WEBPACK_ENTRY: any;

const ROOMS: Map<string, {
  name: string,
  positions: Map<string, [number, number]>,
}> = new Map();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    height: 600,
    width: 800,
    webPreferences: {
      nodeIntegration: true
    }
  });

  // and load the index.html of the app.
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
ipcMain.on("rooms$get", (event) => {
  event.reply("rooms$set", Object.fromEntries(Array.from(ROOMS.entries()).map(([key, value]) => [key, value.name])));
})

ipcMain.on("rooms$new", (event, name: string) => {
  const id = uuid();
  ROOMS.set(id, { name, positions: new Map() });
  event.returnValue = id;
})

type UserJoinLeave = {
  room: string,
  id: string,
};

ipcMain.on("rooms$join", (event, user: UserJoinLeave) => {
  if (!ROOMS.has(user.room)) {
    return;
  }
  const room = ROOMS.get(user.room)!;
  if (room.positions.has(user.id)) {
    return;
  }
  room.positions.set(user.id, [50, 50]);
})

ipcMain.on("rooms$leave", (event, user: UserJoinLeave) => {
  if (!ROOMS.has(user.room)) {
    return;
  }
  const room = ROOMS.get(user.room)!;
  if (!room.positions.has(user.id)) {
    return;
  }
  room.positions.delete(user.id);
})