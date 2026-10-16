// Agent 卡片：把看板的核心内容做成一个浮在桌面上的小窗口（macOS / Windows）
// Agent Card: a small always-on-top desktop window showing the core of the board (macOS / Windows)
'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CONFIG = (() => { try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'viz', 'app', 'config.json'), 'utf8')); } catch { return {}; } })();
const PORT = Number(process.env.VIZ_PORT || CONFIG.port || 4321);
const BASE = `http://127.0.0.1:${PORT}`;
const WIDTH = 340;
const ZH = (() => {
  const v = process.env.CAT_LANG || CONFIG.lang;
  if (v === 'zh' || v === 'en') return v === 'zh';
  return /^zh/i.test(app.getLocale ? app.getLocale() : '') || /^zh/i.test(process.env.LANG || '');
})();
const L = (zh, en) => (ZH ? zh : en);

// 皮肤列表跟看板用同一个文件 / the skin list comes from the board's own file
const SKINS = (() => { try { return require(path.join(os.homedir(), '.claude', 'viz', 'app', 'public', 'skins.js')).LIST; } catch { return []; } })();
let skin = 'none';
let win = null, tray = null, prefs = { pinned: true, x: null, y: null, visible: true };
const PREFS = () => path.join(app.getPath('userData'), 'card.json');
function loadPrefs() { try { prefs = { ...prefs, ...JSON.parse(fs.readFileSync(PREFS(), 'utf8')) }; } catch { } }
function savePrefs() { try { fs.writeFileSync(PREFS(), JSON.stringify(prefs)); } catch { } }

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => showCard());

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  const x = prefs.x != null ? prefs.x : wa.x + wa.width - WIDTH - 24;
  const y = prefs.y != null ? prefs.y : wa.y + 24;
  const mac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: WIDTH, height: 260, x, y, title: 'Agent Card',
    frame: false, transparent: true, resizable: false, maximizable: false, fullscreenable: false, minimizable: false,
    skipTaskbar: true, hasShadow: true, show: false, alwaysOnTop: prefs.pinned,
    backgroundColor: '#00000000',
    ...(mac ? { vibrancy: 'hud', visualEffectState: 'active', roundedCorners: true } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (prefs.pinned) win.setAlwaysOnTop(true, 'floating');
  if (mac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.on('page-title-updated', e => e.preventDefault());
  load();
  win.webContents.on('did-fail-load', () => setTimeout(load, 3000));   // 看板还没启动时，过一会儿再试 / retry until the board is up
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // 每次启动都显示（隐藏只在这一次运行里有效）；再次打开程序也会把卡片叫出来
  // always shown at start (hiding lasts for this run only); opening the app again brings the card back
  win.once('ready-to-show', () => { win.showInactive(); prefs.visible = true; savePrefs(); buildMenu(); });
  win.on('moved', () => { const [bx, by] = win.getPosition(); prefs.x = bx; prefs.y = by; savePrefs(); });
}
function load() { if (win && !win.isDestroyed()) win.loadURL(BASE + '/mini').catch(() => setTimeout(load, 3000)); }
function showCard() { if (!win) return; win.showInactive(); prefs.visible = true; savePrefs(); buildMenu(); }
function hideCard() { if (!win) return; win.hide(); prefs.visible = false; savePrefs(); buildMenu(); }
function setPinned(v) { prefs.pinned = !!v; savePrefs(); if (win) win.setAlwaysOnTop(prefs.pinned, 'floating'); buildMenu(); }

ipcMain.on('card:resize', (_e, h) => {
  if (!win) return;
  const height = Math.max(120, Math.min(720, Math.round(Number(h) || 0)));
  const [w, cur] = win.getSize();
  if (Math.abs(cur - height) > 1) win.setSize(w, height, false);
});
ipcMain.on('card:hide', () => hideCard());
ipcMain.on('card:pin', (_e, v) => setPinned(v));
ipcMain.handle('card:pinned', () => prefs.pinned);
ipcMain.on('card:full', () => shell.openExternal(BASE + '/'));
ipcMain.on('card:skin', (_e, id) => { if (id && id !== skin) { skin = id; buildMenu(); } });
function setSkin(id) {
  skin = id; buildMenu();
  fetch(BASE + '/api/skin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skin: id }) }).catch(() => { });
}

// 自动选模型的开关：和 Claude Code 里的 /route on/off 是同一个文件，下一句话起生效
// the auto-router switch: the same file as /route auto|off in Claude Code; takes effect from the next message
const ROUTER_DIR = path.join(os.homedir(), '.claude', 'auto-router');
const MODE_FILE = path.join(ROUTER_DIR, 'mode.json');
function routerMode() {
  try { return String(JSON.parse(fs.readFileSync(MODE_FILE, 'utf8')).mode || 'auto').toLowerCase(); } catch { return 'auto'; }
}
function setRouter(on) {
  try { fs.writeFileSync(MODE_FILE, JSON.stringify({ mode: on ? 'auto' : 'off', at: new Date().toISOString(), by: 'card' }) + '\n'); } catch { }
  buildMenu();
}
function routerItem() {
  if (!fs.existsSync(ROUTER_DIR)) return [];
  const m = routerMode();
  const pinned = m !== 'auto' && m !== 'off';
  const name = pinned ? m.charAt(0).toUpperCase() + m.slice(1) : '';
  return [{
    label: pinned ? L(`自动选模型（现在固定用 ${name}）`, `Auto model routing (pinned to ${name})`) : L('自动选模型', 'Auto model routing'),
    type: 'checkbox', checked: m === 'auto', click: item => setRouter(item.checked),
  }, { type: 'separator' }];
}

function buildMenu() {
  if (!tray) return;
  const visible = win && win.isVisible();
  tray.setContextMenu(Menu.buildFromTemplate([
    ...routerItem(),
    { label: visible ? L('隐藏卡片', 'Hide card') : L('显示卡片', 'Show card'), click: () => (visible ? hideCard() : showCard()) },
    { label: L('总在最前', 'Always on top'), type: 'checkbox', checked: prefs.pinned, click: m => setPinned(m.checked) },
    ...(SKINS.length ? [{ label: L('皮肤', 'Skin'), submenu: SKINS.map(k => ({ label: ZH ? k.zh : k.en, type: 'radio', checked: k.id === skin, click: () => setSkin(k.id) })) }] : []),
    { label: L('打开完整看板', 'Open full board'), click: () => shell.openExternal(BASE + '/') },
    { type: 'separator' },
    { label: L('退出', 'Quit'), click: () => app.quit() },
  ]));
}

const PIDFILE = path.join(os.homedir(), '.claude', 'viz', 'widget.pid');
app.on('will-quit', () => { try { if (fs.readFileSync(PIDFILE, 'utf8') === String(process.pid)) fs.unlinkSync(PIDFILE); } catch { } });

app.whenReady().then(() => {
  try { fs.writeFileSync(PIDFILE, String(process.pid)); } catch { }   // 安装/卸载脚本靠它关掉旧窗口 / installers use it to close the old card
  loadPrefs();
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  const img = process.platform === 'darwin'
    ? nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png'))
    : nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  if (process.platform === 'darwin') img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('Agent Card');
  tray.on('click', () => (win && win.isVisible() ? hideCard() : showCard()));
  createWindow();
  buildMenu();
  // 在 Claude Code 里用 /route 改了开关，菜单的勾也跟着变 / keep the tick in sync when /route changes it
  try { fs.watchFile(MODE_FILE, { interval: 2000 }, () => buildMenu()); } catch { }
});
app.on('window-all-closed', e => e.preventDefault());
app.on('activate', () => showCard());
