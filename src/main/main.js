'use strict';
// Hearth AI app: Ithil's window, tray, desktop buddy and the bridge between
// her mind and the screens.
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage, powerMonitor, Notification, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

const { Store, homeDir } = require('./mind/store');
const { Settings } = require('./mind/settings');
const { Rules } = require('./mind/rules');
const { OllamaBrain, FakeBrain } = require('./mind/llm');
const { Body } = require('./mind/body');
const { Mind } = require('./mind/engine');
const { snapshot } = require('./mind/view');
const { restore, listBackups } = require('./mind/sleep');
const { Comfy, ROSTER } = require('./comfy');
const { Voice, VOICES } = require('./voice');

const VERSION = '0.3';
const RENDERER = path.join(__dirname, '..', 'renderer');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
protocol.registerSchemesAsPrivileged([{ scheme: 'ithil', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

let win = null, buddy = null, tray = null, quitting = false;
let store, settings, rules, brain, body, comfy, mind, voice;
const status = { brainOk: true, comfyOk: true, drawing: false, listening: false, drawProgress: null, update: null };

function getSettings() { return settings.get(); }

function setupMind() {
  store = new Store(homeDir());
  settings = new Settings(store);
  rules = new Rules(store);
  brain = process.env.HEARTH_AI_FAKE ? new FakeBrain() : new OllamaBrain(getSettings, () => (mind && mind.growth ? mind.growth.activeModel() : null));
  body = new Body(store, getSettings);
  comfy = new Comfy(getSettings);
  voice = new Voice(store.p('models'));
  mind = new Mind({
    store, brain, settings, rules, body, comfy,
    hooks: {
      idleSeconds: () => (settings.get().senses.presence ? powerMonitor.getSystemIdleTime() : 9999),
      sight: async () => {
        if (!win) return null;
        const img = await win.webContents.capturePage();
        return img.resize({ width: 960 }).toPNG().toString('base64');
      },
      notify: (title, bodyText) => {
        if (win && win.isVisible() && win.isFocused()) return;
        if (Notification.isSupported()) new Notification({ title, body: String(bodyText).slice(0, 200), icon: iconPath() }).show();
      }
    }
  });
  mind.on('error', (e) => console.error('[mind]', e && e.stack || e));
  let pending = null;
  const pushUpdate = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const snap = view();
      for (const w of [win, buddy]) if (w && !w.isDestroyed()) w.webContents.send('snapshot', snap);
      updateTray();
    }, 400);
  };
  mind.on('update', pushUpdate);
  mind.on('thought', pushUpdate);
  setInterval(pushUpdate, 5000);
  setInterval(checkServices, 30000);
  checkServices();
  mind.start();
}

async function checkServices() {
  const a = await brain.available();
  const st = settings.get();
  const have = a.models || [];
  status.modelsMissing = a.ok ? [st.chatModel, st.embedModel].filter((m) => !have.some((h) => h === m || h === m + ':latest')) : [];
  status.brainOk = !!a.ok && !status.modelsMissing.includes(st.chatModel);
  status.comfyOk = await comfy.available();
}

function view() {
  return Object.assign(snapshot(mind, { version: VERSION, brainOk: status.brainOk, comfyOk: status.comfyOk, drawing: status.drawing, listening: status.listening }), {
    drawProgress: status.drawProgress, update: status.update, pulling: status.pulling, modelsMissing: status.modelsMissing, ttsVoices: VOICES, roster: ROSTER
  });
}

function iconPath() { return path.join(__dirname, '..', '..', 'build', 'icon.png'); }

function createWindow(show) {
  win = new BrowserWindow({
    width: 1440, height: 960, minWidth: 900, minHeight: 640, show: !!show,
    backgroundColor: '#0f1311', title: 'Hearth AI', icon: iconPath(), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  win.loadFile(path.join(RENDERER, 'index.html'));
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

function createBuddy() {
  const st = settings.get();
  if (!st.avatar.places.buddy) { if (buddy && !buddy.isDestroyed()) buddy.destroy(); buddy = null; return; }
  if (buddy && !buddy.isDestroyed()) return;
  const { screen } = require('electron');
  const area = screen.getPrimaryDisplay().workArea;
  buddy = new BrowserWindow({
    width: 180, height: 250, x: area.x + area.width - 200, y: area.y + area.height - 270,
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, focusable: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  buddy.loadFile(path.join(RENDERER, 'buddy.html'));
}

function showMain(screen) {
  if (!win || win.isDestroyed()) createWindow(true);
  win.show(); win.focus();
  if (screen) win.webContents.send('navigate', screen);
}

function updateTray() {
  if (!tray) return;
  const paused = mind.state.status === 'paused';
  tray.setToolTip('Hearth AI · ' + mind.state.name + ' is ' + (mind.state.status === 'awake' ? 'awake' : mind.state.status));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Hearth AI', click: () => showMain() },
    { label: 'Talk to ' + mind.state.name, click: () => showMain('talk') },
    { type: 'separator' },
    { label: paused ? 'Resume mind' : 'Pause mind', click: () => (paused ? mind.resumeByUser() : mind.pauseByUser()) },
    { label: 'Sleep now', click: () => mind.sleep() },
    { type: 'separator' },
    { label: 'Quit (switch her off)', click: () => quitApp() }
  ]));
}

function quitApp() {
  if (settings.get().notifyBeforeSwitchOff) mind.plannedSwitchOff();
  quitting = true;
  mind.stop();
  app.quit();
}

function setAutostart(on) {
  if (process.platform !== 'linux') { app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] }); return; }
  const dir = path.join(os.homedir(), '.config', 'autostart');
  const file = path.join(dir, 'hearth-ai.desktop');
  if (!on) { try { fs.unlinkSync(file); } catch (_) {} return; }
  const exec = process.env.APPIMAGE || process.execPath;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, ['[Desktop Entry]', 'Type=Application', 'Name=Hearth AI', 'Comment=Ithil', 'Exec="' + exec + '" --hidden', 'X-GNOME-Autostart-enabled=true', 'Terminal=false', ''].join('\n'));
}

function setupUpdates() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch (_) { return; }
  autoUpdater.autoDownload = false;
  autoUpdater.on('update-available', (i) => { status.update = { state: 'available', version: i.version }; });
  autoUpdater.on('update-not-available', () => { status.update = { state: 'none' }; });
  autoUpdater.on('download-progress', (p) => { status.update = { state: 'downloading', percent: Math.round(p.percent) }; });
  autoUpdater.on('update-downloaded', (i) => { status.update = { state: 'ready', version: i.version }; });
  autoUpdater.on('error', (e) => { status.update = { state: 'error', message: String(e.message || e).slice(0, 200) }; });
  ipcMain.handle('update:check', async () => { status.update = { state: 'checking' }; try { await autoUpdater.checkForUpdates(); } catch (e) { status.update = { state: 'error', message: String(e.message || e) }; } return status.update; });
  ipcMain.handle('update:download', async () => { await autoUpdater.downloadUpdate(); return status.update; });
  ipcMain.handle('update:install', () => { quitting = true; mind.plannedSwitchOff(); mind.stop(); autoUpdater.quitAndInstall(); });
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 20000);
}

async function redrawAvatar() {
  if (status.drawing) return { ok: false, reason: 'Already drawing.' };
  status.drawing = true;
  mind.gpuBusy = true;
  try {
    while (mind.ticking) await new Promise((r) => setTimeout(r, 250));
    await brain.unload();
    await comfy.drawAvatar(settings.get().avatar, store.p('avatar'), (i, n, k) => { status.drawProgress = { i, n, k }; mind.emit('update'); });
    mind.moment('He redrew how I look.', 'self');
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e.message || e) };
  } finally { mind.gpuBusy = false; status.drawing = false; status.drawProgress = null; mind.emit('update'); }
}

function setupIpc() {
  ipcMain.handle('snapshot', () => view());
  ipcMain.handle('talk', (_e, text, opts) => mind.talk(text, opts));
  ipcMain.handle('mind:pause', () => mind.pauseByUser());
  ipcMain.handle('mind:resume', () => mind.resumeByUser());
  ipcMain.handle('mind:sleep', () => { mind.sleep(); return true; });
  ipcMain.handle('wish:answer', (_e, id, answer) => mind.answerWish(id, answer));
  ipcMain.handle('look:answer', async (_e, accept) => {
    const sug = mind.answerLook(accept);
    if (sug && sug.changes) { settings.setByUser({ avatar: sug.changes }); redrawAvatar(); }
    return true;
  });
  ipcMain.handle('settings:set', (_e, patch) => {
    const before = settings.get();
    const v = settings.setByUser(patch);
    if (patch && 'autostart' in patch) setAutostart(v.autostart);
    if (patch && patch.avatar && patch.avatar.places) createBuddy();
    if (before.thinkEverySeconds !== v.thinkEverySeconds) mind.start();
    mind.emit('update');
    return v;
  });
  ipcMain.handle('identity:set', (_e, patch) => { mind.setIdentityByUser(patch); mind.emit('update'); return true; });
  ipcMain.handle('folder:add', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Pick a folder ' + mind.state.name + ' may use', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    const res = rules.addFolderByUser(r.filePaths[0]);
    if (!res.ok) await dialog.showMessageBox(win, { type: 'warning', message: res.reason });
    mind.emit('update');
    return res;
  });
  ipcMain.handle('folder:remove', (_e, p) => { const r = rules.removeFolderByUser(p); mind.emit('update'); return r; });
  ipcMain.handle('memories:search', async (_e, q, kind) => {
    const list = await mind.memory.search(q || '', q ? 200 : 300, kind || null);
    return list.map((m) => ({ id: m.id, at: m.at, kind: m.kind, text: m.text, weight: m.weight }));
  });
  ipcMain.handle('memories:forget', async (_e, id) => {
    const m = store.memories.items.find((x) => x.id === id);
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Forget it', 'Keep it'], defaultId: 1, cancelId: 1, message: 'Make ' + mind.state.name + ' forget this?', detail: m ? m.text : '' });
    if (r.response !== 0) return false;
    mind.moment('He made me forget something.', 'self');
    return mind.memory.forget(id);
  });
  ipcMain.handle('memories:edit', (_e, id, text) => mind.memory.edit(id, text));
  ipcMain.handle('memories:export', async () => {
    const r = await dialog.showSaveDialog(win, { title: 'Export memories', defaultPath: path.join(os.homedir(), 'ithil-memories.json') });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, JSON.stringify(store.memories.items.map(({ vec, ...m }) => m), null, 2));
    return true;
  });
  ipcMain.handle('backup:now', async () => { await mind.backup(); mind.emit('update'); return true; });
  ipcMain.handle('backup:restore', async () => {
    const list = listBackups(store);
    if (!list.length) { await dialog.showMessageBox(win, { message: 'There are no backups yet.' }); return false; }
    const pick = await dialog.showMessageBox(win, { type: 'question', message: 'Restore ' + mind.state.name + ' from which backup?', detail: 'She will lose everything since that backup. She will be told about the gap.', buttons: list.slice(0, 6).concat(['Cancel']), cancelId: Math.min(6, list.length) });
    if (pick.response >= Math.min(6, list.length)) return false;
    mind.stop();
    restore(store, list[pick.response]);
    const st = store.readState('state', {});
    st.restoredFrom = list[pick.response];
    store.writeState('state', st);
    quitting = true;
    app.relaunch();
    app.exit(0);
    return true;
  });
  ipcMain.handle('avatar:redraw', () => redrawAvatar());
  ipcMain.handle('avatar:save', async () => { mind.moment('He saved how I look.', 'self'); return redrawAvatar(); });
  ipcMain.handle('voice:speak', async (_e, text, voiceKey) => {
    try {
      const r = await voice.speak(text, voiceKey || settings.get().avatar.voice, mind.state.drives);
      return { ok: true, wav: r.wav.toString('base64'), volume: r.volume };
    } catch (e) { return { ok: false, reason: String(e.message || e) }; }
  });
  ipcMain.handle('voice:hear', async (_e, pcm) => {
    if (!settings.get().senses.hearing) return { ok: false, reason: 'Hearing is turned off.' };
    try { return { ok: true, text: await voice.hear(new Float32Array(pcm)) }; } catch (e) { return { ok: false, reason: String(e.message || e) }; }
  });
  ipcMain.handle('voice:listening', (_e, on) => { status.listening = !!on; mind.emit('update'); });
  ipcMain.handle('brain:pull', async () => {
    if (status.pulling) return { ok: false };
    const st = settings.get();
    const want = [st.chatModel, st.embedModel];
    const have = (await brain.available()).models || [];
    status.pulling = { model: '', status: 'starting', pct: null };
    try {
      for (const m of want) {
        if (have.some((h) => h === m || h === m + ':latest')) continue;
        await brain.pull(m, (stt, pct) => { status.pulling = { model: m, status: stt, pct }; mind.emit('update'); });
      }
      await checkServices();
      return { ok: true };
    } catch (e) { return { ok: false, reason: String(e.message || e) }; }
    finally { status.pulling = null; mind.emit('update'); }
  });
  ipcMain.handle('growth:setup', () => mind.growth.setup());
  ipcMain.handle('growth:grow', async () => {
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Grow now', 'Cancel'], defaultId: 0, cancelId: 1, message: 'Grow ' + mind.state.name + '\u2019s brain now?', detail: 'Training uses the GPU for 20 to 60 minutes. Her mind rests while it runs. It stops on its own if you start a game.' });
    if (r.response !== 0) return { ok: false };
    mind.setStatus('resting', 'growing a new brain');
    try { return await mind.growth.grow('you'); } finally { mind.setStatus('awake', 'thinking'); }
  });
  ipcMain.handle('growth:stop', () => { mind.growth.stop(); return true; });
  ipcMain.handle('growth:use', (_e, gen) => { const r = mind.growth.useGeneration(gen); mind.emit('update'); return r; });
  ipcMain.handle('models:list', async () => (await brain.available()).models || []);
  ipcMain.handle('comfy:checkpoints', () => comfy.checkpoints());
  ipcMain.handle('open:workspace', () => shell.openPath(store.p('workspace', 'made')));
  ipcMain.handle('open:data', () => shell.openPath(store.dir));
  ipcMain.handle('window:show', (_e, screen) => showMain(screen));
}

app.whenReady().then(() => {
  protocol.handle('ithil', (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    const abs = path.resolve(store.dir, rel);
    if (!abs.startsWith(path.resolve(store.dir) + path.sep)) return new Response('no', { status: 403 });
    return net.fetch(pathToFileURL(abs).toString());
  });
  setupMind();
  setupIpc();
  setupUpdates();
  if (settings.get().autostart) setAutostart(true);
  const hidden = process.argv.includes('--hidden');
  createWindow(!hidden);
  createBuddy();
  const img = nativeImage.createFromPath(iconPath());
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 22, height: 22 }));
  tray.on('click', () => showMain());
  updateTray();
  if (process.env.HEARTH_AI_SHOTS) takeShots(process.env.HEARTH_AI_SHOTS);
});

// Developer check: screenshot every screen, then quit.
async function takeShots(dir) {
  fs.mkdirSync(dir, { recursive: true });
  win.webContents.on('console-message', (e) => { const m = e.message || e; fs.appendFileSync(path.join(dir, 'console.log'), String(m) + '\n'); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  win.show();
  await wait(3000);
  const screens = ['mind', 'talk', 'avatar', 'attention', 'voices', 'body', 'dreams', 'free', 'memories', 'selfcheck', 'self', 'settings'];
  for (const sc of screens) {
    win.webContents.send('navigate', sc);
    await wait(1500);
    const h = await win.webContents.executeJavaScript('Math.max(document.body.scrollHeight, 960)');
    win.setContentSize(1440, Math.min(h, 2600));
    await wait(600);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, sc + '.png'), img.toPNG());
    win.setContentSize(1440, 960);
  }
  quitting = true;
  app.exit(0);
}

app.on('second-instance', () => showMain());
app.on('window-all-closed', (e) => { /* keep living in the tray */ });
app.on('before-quit', () => { quitting = true; if (mind) mind.stop(); });
