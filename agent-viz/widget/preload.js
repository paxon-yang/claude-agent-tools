// 只暴露卡片需要的几个动作 / expose only what the card page needs
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('widget', {
  platform: process.platform,
  resize: h => ipcRenderer.send('card:resize', h),
  hide: () => ipcRenderer.send('card:hide'),
  quit: () => ipcRenderer.send('card:quit'),   // 关掉整个卡片程序 / quit the card app
  setPinned: v => ipcRenderer.send('card:pin', v),
  getPinned: () => ipcRenderer.invoke('card:pinned'),
  openFull: () => ipcRenderer.send('card:full'),
  skin: id => ipcRenderer.send('card:skin', id),
});
