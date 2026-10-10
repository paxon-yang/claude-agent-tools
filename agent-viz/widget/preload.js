// 只暴露卡片需要的几个动作 / expose only what the card page needs
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('widget', {
  platform: process.platform,
  resize: h => ipcRenderer.send('card:resize', h),
  hide: () => ipcRenderer.send('card:hide'),
  setPinned: v => ipcRenderer.send('card:pin', v),
  getPinned: () => ipcRenderer.invoke('card:pinned'),
  openFull: () => ipcRenderer.send('card:full'),
});
