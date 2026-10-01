// Minimal bridge for the widget window; pages get no Node access.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agenticDesktop", {
  resize: (height) => ipcRenderer.send("widget:resize", height),
  hideWidget: () => ipcRenderer.send("widget:hide"),
  openDashboard: () => ipcRenderer.send("app:open-dashboard"),
});
