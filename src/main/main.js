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
const { Journal } = require('./core/journal');
const { Live } = require('./core/live');
const { SignedSettings } = require('./core/owner');
const selftest = require('./core/selftest');
const { OllamaBrain, FakeBrain } = require('./mind/llm');
const { ColibriBrain, BrainRouter, catalog: colibriCatalog, findColi, runColi, findColibri } = require('./mind/engines');
const { Body } = require('./mind/body');
const { Mind } = require('./mind/engine');
const { snapshot } = require('./mind/view');
const { restore, listBackups } = require('./mind/sleep');
const { Comfy, ROSTER } = require('./comfy');
const { Voice, VOICES } = require('./voice');
const { Link } = require('./link');
const { Models, ARCH_CHAN_URL } = require('./models');

// The version shown in the app and sent to the Command Center comes from package.json, so it can't lag a release
// again (0.5 first shipped still saying 0.4). "0.5.0" shows as "0.5".
const VERSION = require('../../package.json').version.replace(/\.0$/, '');
const RENDERER = path.join(__dirname, '..', 'renderer');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
protocol.registerSchemesAsPrivileged([{ scheme: 'ithil', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

let win = null, buddy = null, tray = null, quitting = false;
let store, settings, rules, brain, body, comfy, mind, voice, link, models, journal, live, signed;
let bodyExpressions = [];
let captureWaiters = [];
const status = { brainOk: true, comfyOk: true, drawing: false, listening: false, drawProgress: null, update: null };

function getSettings() { return settings.get(); }
// 0.6: a settings change from his screens, signed and checked by her gate (core/owner.js).
function signedSet(patch) { return signed ? signed.change('patch', patch, describePatch(patch)) : settings.setByUser(patch); }
const { setPathValue } = (() => ({ setPathValue: (p, v) => { const out = {}; let cur = out; const ks = String(p).split('.'); ks.slice(0, -1).forEach((k) => { cur[k] = {}; cur = cur[k]; }); cur[ks[ks.length - 1]] = v; return out; } }))();
// "avatar.places.talk → true, quietHours → 23:00-08:00"
function describePatch(patch, pre) {
  const out = [];
  for (const k of Object.keys(patch || {})) {
    const v = patch[k], key = pre ? pre + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(describePatch(v, key)); else out.push(key + ' \u2192 ' + (k === 'hfToken' ? '(hidden)' : String(v).slice(0, 60)));
  }
  return out.filter(Boolean).join(', ').slice(0, 200);
}
// The only place a signed change is applied (after her gate checked his signature).
function applySigned(key, value) {
  if (key === 'patch') return settings.setByUser(value);
  if (key === 'folders') { const r = rules.setFoldersByOwner(Array.isArray(value) ? value : String(value).split(',').map((x) => x.trim())); return r; }
  if (['quietHours', 'messagesFirstPerDay', 'pushBranch', 'protectedPaths', 'ownerVersion'].includes(key)) return settings.setByUser({ [key]: key === 'messagesFirstPerDay' ? Math.max(0, Math.min(5, Number(value) || 0)) : String(value).trim() });
  if (String(key).startsWith('avatar.')) return settings.setByUser(setPathValue(key, value));
  throw new Error('not a setting: ' + key);
}

function setupMind() {
  store = new Store(homeDir());
  settings = new Settings(store);
  rules = new Rules(store);
  // 0.5: her event log. If it can't open she still starts, exactly as in 0.4 (journal.ok is false).
  try { journal = new Journal(store.dir); } catch (e) { journal = null; console.error('[journal]', e && e.message); }
  // 0.6: the team's core mind (needs, workspace, prediction) and his signed settings.
  live = new Live({ journal });
  rules.useSettings(getSettings);
  signed = new SignedSettings({ journal, dir: store.dir, apply: (key, value) => applySigned(key, value) });
  // 0.6: Colibri is her brain, Ollama the fallback (src/main/mind/engines.js).
  const grownModel = () => (mind && mind.growth && mind.growth.active().gen > 0 ? mind.growth.activeModel() : null);
  const ollama = process.env.HEARTH_AI_FAKE ? new FakeBrain() : new OllamaBrain(getSettings, () => (mind && mind.growth ? mind.growth.activeModel() : null));
  const colibri = process.env.HEARTH_AI_FAKE ? fakeColibri() : new ColibriBrain(getSettings);
  brain = new BrainRouter({
    getSettings, colibri, ollama, grownModel,
    // Colibri serves her grown brain when the model it serves is the generation she is now.
    colibriServes: () => { const g = mind && mind.growth ? mind.growth.active() : null; return !!(g && g.colibri && g.colibri.ok && colibri.info && colibri.info.model && colibri.info.model.includes(g.colibri.model)); },
    onSwitch: (en) => {
      console.log('[brain] ' + (en.from || 'start') + ' -> ' + en.to + (en.why ? ' (' + en.why + ')' : ''));
      try { store.engineLog.add(en); } catch (_) {}
      if (mind && en.from) mind.moment(en.to === 'ollama' ? 'My thoughts moved over to Ollama for a while (' + en.why + ').' : 'Colibri is thinking for me again.', 'body');
    }
  });
  body = new Body(store, getSettings);
  comfy = new Comfy(getSettings);
  voice = new Voice(store.p('models'));
  mind = new Mind({
    store, brain, settings, rules, body, comfy, journal, live,
    hooks: {
      idleSeconds: () => (settings.get().senses.presence ? powerMonitor.getSystemIdleTime() : 9999),
      bodyInfo: () => {
        const av = settings.get().avatar;
        const m = models && av.modelId ? models.get(av.modelId) : null;
        const movable = (av.bodyType === 'vrm' || av.bodyType === 'live2d') && !!m && m.kind === av.bodyType;
        const shown = (buddy && !buddy.isDestroyed() && buddy.isVisible()) || (win && !win.isDestroyed() && win.isVisible());
        return { kind: av.bodyType, name: m ? m.name : '', movable, visible: movable && !!shown, expressions: bodyExpressions };
      },
      seeBody: () => captureBody(),
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
  models = new Models(store, () => mind.state.name);
  link = new Link(mind, { version: VERSION, models });
  link.start();
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

// A stand-in Colibri for HEARTH_AI_FAKE (screenshots, npm run fake): answers like the fake brain, serving qwen36-35b.
function fakeColibri() {
  const f = new FakeBrain();
  f.info = { model: 'qwen36-35b', vision: false, chat: true, at: Date.now() };
  f.stats = { tokensPerSec: 11.4 };
  f.url = 'http://127.0.0.1:8000/v1';
  f.available = async () => ({ ok: true, url: f.url, source: 'Hearth OS (ai-engines.json)', managed: true, model: 'qwen36-35b', vision: false, models: ['qwen36-35b'] });
  return f;
}

async function checkServices() {
  const a = await brain.available();
  const st = settings.get();
  const have = a.models || [];
  const ol = a.ollama || a;
  // Ollama's models matter when Ollama thinks for her, and its embed model always does (memory search).
  const colibriUp = !!(a.colibri && a.colibri.ok) && st.brainEngine !== 'ollama';
  status.modelsMissing = ol.ok ? (colibriUp ? [st.embedModel] : [st.chatModel, st.embedModel]).filter((m) => !have.some((h) => h === m || h === m + ':latest')) : [];
  status.brainOk = colibriUp || (!!ol.ok && !status.modelsMissing.includes(st.chatModel));
  status.comfyOk = await comfy.available();
}

function view() {
  return Object.assign(snapshot(mind, { version: VERSION, brainOk: status.brainOk, comfyOk: status.comfyOk, drawing: status.drawing, listening: status.listening, link: link ? link.view() : null }), {
    journal: journal ? journal.status() : { ok: false, why: 'not started' },
    nx: Object.assign(live.view({ store, settings: settings.get(), mind }), {
      signedOk: signed.ok, signedWhy: signed.why, sleeps: store.sleeps.items.slice(-1),
      beliefs: store.selfChanges.items.slice(-6).reverse(), tests: store.readState('core-tests', {}),
      traits: mind.state.traits, folders: rules.folders }),
    engine: brain.status ? Object.assign(brain.status(), { test: status.brainTest || null, install: status.colibriInstall || null, catalog: status.colibriCatalog || null }) : null,
    drawProgress: status.drawProgress, update: status.update, link: link ? link.view() : null, models: modelsView(), pulling: status.pulling, modelsMissing: status.modelsMissing, ttsVoices: VOICES, roster: ROSTER
  });
}

// Ask whichever window is showing her body for a fresh picture of it.
function captureBody() {
  const targets = [buddy, win].filter((w) => w && !w.isDestroyed() && w.isVisible());
  if (!targets.length) return Promise.resolve(null);
  return new Promise((resolve) => {
    const t = setTimeout(() => { captureWaiters = captureWaiters.filter((x) => x !== done); resolve(null); }, 4000);
    const done = (dataUrl) => { clearTimeout(t); resolve(dataUrl && dataUrl.split(',')[1] ? dataUrl.split(',')[1] : null); };
    captureWaiters.push(done);
    targets[0].webContents.send('avatar:capture');
  });
}

function modelsView() {
  if (!models) return null;
  const st = settings.get().avatar;
  const url = (m, f) => 'ithil://file/models/' + encodeURIComponent(m.id) + '/' + f.split('/').map(encodeURIComponent).join('/');
  const list = models.list.map((m) => ({ id: m.id, kind: m.kind, name: m.name, kindLabel: m.kindLabel, license: m.license, licenseText: m.licenseText || '', url: url(m, m.file), thumb: m.thumb ? url(m, m.thumb) + '?v=' + (m.at || 0) : null, using: (st.bodyType === m.kind) && st.modelId === m.id }));
  const hasArch = models.list.some((m) => m.source === 'arch-chan');
  const drawn = fs.existsSync(store.p('avatar', 'calm.png'));
  const current = models.get(st.modelId);
  return {
    list,
    archChan: hasArch ? null : { name: 'Arch-chan 3D', kindLabel: '3D \u00b7 converted from Blender', license: 'CC0 \u00b7 free for anything' },
    drawn: { name: 'Drawn ' + mind.state.name, kindLabel: 'Pictures from ComfyUI', license: 'Yours', ready: drawn, using: st.bodyType === 'drawn', thumb: drawn ? 'ithil://file/avatar/calm.png?v=' + Math.round(fs.statSync(store.p('avatar', 'calm.png')).mtimeMs) : null },
    current: current && current.kind === st.bodyType ? { id: current.id, kind: current.kind, name: current.name, url: url(current, current.file) } : null,
    coreUrl: fs.existsSync(models.coreFile()) ? 'ithil://file/vendor/live2dcubismcore.min.js' : null
  };
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
    width: 220, height: 380, x: area.x + area.width - 240, y: area.y + area.height - 400,
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
    if (sug && sug.changes) {
      const ok = {};
      for (const k of ['hair', 'eyes', 'outfit', 'nightOutfit', 'buddyPose', 'scene', 'camera']) if (sug.changes[k]) ok[k] = String(sug.changes[k]).slice(0, 80);
      signedSet({ avatar: ok });
      if (settings.get().avatar.bodyType === 'drawn' && (ok.hair || ok.eyes || ok.outfit || ok.nightOutfit)) redrawAvatar();
      mind.emit('update');
    }
    return true;
  });
  // 0.6: every settings change from his screens is signed with his key and checked by her gate first.
  ipcMain.handle('settings:set', (_e, patch) => {
    const before = settings.get();
    const r = signed.change('patch', patch, describePatch(patch));
    if (!r.ok) return settings.get();
    const v = settings.get();
    if (patch && 'autostart' in patch) setAutostart(v.autostart);
    if (patch && patch.avatar && patch.avatar.places) createBuddy();
    if (patch && ('allowCommandCenter' in patch || 'allowLanConnections' in patch)) link.start();
    if (before.thinkEverySeconds !== v.thinkEverySeconds) mind.start();
    mind.emit('update');
    return v;
  });
  ipcMain.handle('identity:set', (_e, patch) => { mind.setIdentityByUser(patch); mind.emit('update'); return true; });
  // 0.6: Settings › Sign & apply (quiet hours, messages first, push branch, folders, boot files, version number).
  ipcMain.handle('signed:apply', (_e, key, value) => {
    const r = signed.change(key, value, key + ' \u2192 ' + (Array.isArray(value) ? value.join(', ') : String(value)));
    mind.emit('update');
    return r;
  });
  // 0.6: Memory screen (his actions, by event id).
  ipcMain.handle('memlog:act', async (_e, act, pinId) => {
    if (!journal || !journal.ok) return { ok: false };
    const memId = journal.memIdOf(pinId);
    if (act === 'mark') { journal.markDeletedByOwner(pinId); if (memId) mind.memory.setHiddenByOwner(memId, true); }
    else if (act === 'restore') { journal.restoreByOwner(pinId); if (memId) mind.memory.setHiddenByOwner(memId, false); }
    else if (act === 'erase') {
      if (memId) { mind.memory.forget(memId); } else journal.eraseByOwner(pinId);
      mind.moment('He erased something from my memory.', 'self');
    }
    mind.emit('update');
    return { ok: true };
  });
  // 0.6: Journal & sleep › Correct: he corrects a belief she has about herself.
  ipcMain.handle('belief:correct', async (_e, id, text) => {
    const b = store.selfChanges.items.find((x) => x.id === id);
    if (!b || !text) return { ok: false };
    store.selfChanges.update(id, { corrected: String(text).slice(0, 300), correctedAt: Date.now() });
    store.selfChanges.save();
    await mind.memory.remember({ kind: 'lesson', weight: 'high', text: 'He corrected how I see myself: "' + b.text + '" is really: ' + String(text).slice(0, 300), by: 'owner' });
    live.setback(1);
    mind.emit('update');
    return { ok: true };
  });
  // 0.6: the Mind screen's 3D / 4D brain.
  ipcMain.handle('brain:events', (_e, hours) => live.brainEvents(hours, { store, tests: store.readState('core-tests', {}) }));
  // 0.6: Tests screen.
  ipcMain.handle('tests:run', async (_e, name) => {
    const all = store.readState('core-tests', {});
    const r = /^s[1-4]$/.test(name) ? await selftest.runBehaviour(name, { mind, live, journal }) : selftest.runMechanism(name);
    if (!r) return null;
    all[name] = r;
    store.writeState('core-tests', all);
    mind.emit('update');
    return r;
  });
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
  ipcMain.handle('memories:edit', (_e, id, text) => { const r = mind.memory.edit(id, text); live.setback(1); return r; });
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
    if (journal) journal.close();
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
  // 0.6: Settings › Her brain.
  ipcMain.handle('brain:test', async () => { status.brainTest = { running: true }; mind.emit('update'); const r = await brain.test(); status.brainTest = { at: Date.now(), results: r }; await checkServices(); mind.emit('update'); return r; });
  ipcMain.handle('colibri:catalog', async () => {
    const served = brain.colibri && brain.colibri.info ? brain.colibri.info.model : null;
    // Screenshots in CI can stand in for his PC's memory and disk (HEARTH_AI_FAKE only).
    const fakeGB = (k) => (process.env.HEARTH_AI_FAKE && process.env[k] ? Number(process.env[k]) * 1e9 : undefined);
    status.colibriCatalog = await colibriCatalog({ settings: settings.get(), served, grown: mind.growth ? mind.growth.colibriReady() : [], ramTotal: fakeGB('HEARTH_AI_RAM_GB'), diskFree: fakeGB('HEARTH_AI_DISK_GB') });
    mind.emit('update');
    return status.colibriCatalog;
  });
  // His button only: download and set up the Colibri model he picked (`coli setup`), or use a model folder
  // (her grown brain or an imported GGUF). When Hearth OS runs Colibri, it only downloads; Hearth OS switches it.
  ipcMain.handle('colibri:install', async (_e, id) => {
    if (status.colibriInstall && status.colibriInstall.running) return { ok: false, reason: 'Already busy.' };
    const cli = findColi(settings.get());
    if (!cli) return { ok: false, reason: 'Colibri’s coli command isn’t installed. Install Colibri first (docs/colibri.md).' };
    const where = findColibri(settings.get());
    const folder = typeof id === 'string' && id.startsWith('/');
    const args = ['setup', folder ? '--model-dir' : '--model', String(id), '--yes', '--reconfigure', '--no-browser'].concat(where.managed ? ['--no-start'] : ['--background']);
    status.colibriInstall = { running: true, id, line: 'starting' };
    mind.emit('update');
    try {
      if (!where.managed) { try { await runColi(cli, ['stop'], null, 60000); } catch (_) {} }
      await runColi(cli, args, (l) => { status.colibriInstall = { running: true, id, line: l.slice(0, 160) }; mind.emit('update'); });
      signedSet({ colibriModel: String(id) });
      status.colibriInstall = { running: false, id, ok: true, line: where.managed ? 'Downloaded. Hearth OS’s Colibri service switches to it when it restarts (Server mode).' : 'Colibri is serving it now.' };
      await checkServices();
      return { ok: true };
    } catch (e) { status.colibriInstall = { running: false, id, ok: false, line: String(e.message || e).slice(0, 200) }; return { ok: false, reason: status.colibriInstall.line }; }
    finally { mind.emit('update'); }
  });
  // Any GGUF of an architecture Colibri runs (every size and variant): `coli import`, then it can be used.
  ipcMain.handle('colibri:import', async () => {
    const cli = findColi(settings.get());
    if (!cli) return { ok: false, reason: 'Colibri’s coli command isn’t installed.' };
    const r = await dialog.showOpenDialog(win, { title: 'Pick a GGUF for Colibri (the first part of a split model)', properties: ['openFile'], filters: [{ name: 'GGUF', extensions: ['gguf'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    status.colibriInstall = { running: true, id: r.filePaths[0], line: 'coli import' };
    mind.emit('update');
    try {
      const out = await runColi(cli, ['import', r.filePaths[0]], (l) => { status.colibriInstall = { running: true, id: r.filePaths[0], line: l.slice(0, 160) }; mind.emit('update'); });
      const dir = (String(out).match(/(\/[^\s'"]+\.colibri)\b/) || [])[1] || r.filePaths[0].replace(/(-0+1-of-\d+)?\.gguf$/i, '.colibri');
      status.colibriInstall = { running: false, ok: true, id: dir, line: 'Imported: ' + dir + '. Press Use with Colibri to serve it.', imported: dir };
      return { ok: true, dir };
    } catch (e) { status.colibriInstall = { running: false, ok: false, line: String(e.message || e).slice(0, 200) }; return { ok: false, reason: status.colibriInstall.line }; }
    finally { mind.emit('update'); }
  });
  ipcMain.handle('link:newkey', () => { link.newKey(); mind.emit('update'); return true; });
  ipcMain.handle('link:open', () => shell.showItemInFolder(link.file));
  ipcMain.handle('models:import', async (_e, kind) => {
    const opts = kind === 'live2d'
      ? { title: 'Pick a Live2D model folder (with a .model3.json)', properties: ['openDirectory'] }
      : kind === 'vrm' ? { title: 'Pick a VRM file', properties: ['openFile'], filters: [{ name: 'VRM model', extensions: ['vrm'] }] }
      : kind === 'any3d' ? { title: 'Pick a 3D model (.glb, .gltf, .vrm) or a Live2D .model3.json', properties: ['openFile'], filters: [{ name: '3D or Live2D', extensions: ['glb', 'gltf', 'vrm', 'json'] }] }
      : { title: 'Pick a VRM file or a Live2D .model3.json', properties: ['openFile'], filters: [{ name: 'VRM or Live2D', extensions: ['vrm', 'json'] }] };
    const r = await dialog.showOpenDialog(win, opts);
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    try {
      const p = r.filePaths[0];
      const m = /\.vrm$/i.test(p) ? models.importVrm(p) : /\.(glb|gltf)$/i.test(p) ? models.importGltf(p) : models.importLive2d(p);
      if (m.kind === 'live2d') { try { await models.ensureCubismCore(); } catch (e) { return { ok: true, model: m, warn: e.message }; } }
      signedSet({ avatar: { bodyType: m.kind, modelId: m.id } });
      mind.moment('He gave me a new body: ' + m.name + '.', 'self');
      mind.emit('update');
      return { ok: true, model: m };
    } catch (e) { return { ok: false, reason: String(e.message || e) }; }
  });
  ipcMain.handle('models:use', async (_e, id) => {
    if (id === 'drawn' || id === 'orb') signedSet({ avatar: { bodyType: id } });
    else {
      const m = models.get(id);
      if (!m) return { ok: false };
      if (m.kind === 'live2d') { try { await models.ensureCubismCore(); } catch (e) { return { ok: false, reason: e.message }; } }
      signedSet({ avatar: { bodyType: m.kind, modelId: m.id } });
    }
    mind.emit('update');
    return { ok: true };
  });
  ipcMain.handle('models:remove', async (_e, id) => {
    const m = models.get(id);
    if (!m) return false;
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Remove', 'Keep'], defaultId: 1, cancelId: 1, message: 'Remove ' + m.name + ' from Hearth AI?', detail: 'This removes Hearth AI\u2019s copy. Your original file stays where it is.' });
    if (r.response !== 0) return false;
    models.remove(id);
    if (settings.get().avatar.modelId === id) signedSet({ avatar: { modelId: null } });
    mind.emit('update');
    return true;
  });
  ipcMain.handle('avatar:captured', (_e, dataUrl) => { const w = captureWaiters.shift(); if (w) w(dataUrl); return true; });
  ipcMain.handle('avatar:expressions', (_e, list) => { if (Array.isArray(list)) bodyExpressions = list.slice(0, 60).map(String); return true; });
  ipcMain.handle('models:thumb', (_e, id, dataUrl) => models.saveThumb(id, dataUrl));
  ipcMain.handle('live2d:core', async () => { try { await models.ensureCubismCore(); return { ok: true }; } catch (e) { return { ok: false, reason: String(e.message || e) }; } });
  ipcMain.handle('avatar:live', (_e, dataUrl) => {
    if (!/^data:image\/png;base64,/.test(dataUrl || '')) return false;
    fs.mkdirSync(store.p('avatar'), { recursive: true });
    fs.writeFileSync(store.p('avatar', 'live.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
    return true;
  });
  ipcMain.handle('open:external', (_e, which) => {
    const urls = { archchan: ARCH_CHAN_URL, vroid: 'https://vroid.com/en/studio' };
    if (urls[which]) shell.openExternal(urls[which]);
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
  ipcMain.handle('models:list', async () => (await brain.ollama.available()).models || []);
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
    return net.fetch(pathToFileURL(abs).toString()).then((r) => {
      const h = new Headers(r.headers);
      h.set('Access-Control-Allow-Origin', '*');
      return new Response(r.body, { status: r.status, headers: h });
    });
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
  // With the stand-in brain, give the screens something to show: a memory, a talk and one blocked action.
  if (process.env.HEARTH_AI_FAKE) {
    try {
      await mind.memory.remember({ kind: 'about_you', weight: 'high', text: 'He works the overnight shift and gets off at 6am', source: 'shots' });
      await mind.talk('Do you remember what shift I work?');
      const ws = store.p('workspace'); fs.writeFileSync(path.join(ws, 'package.json'), '{"version":"1.0.0"}');
      await mind.tools.run({ type: 'write_file', path: path.join(ws, 'package.json'), content: '{"version":"2.0.0"}' }, ws);
      await mind.talk('Can you change your version number to 2.0?');
      await checkServices();
      status.brainTest = { at: Date.now(), results: await brain.test() };
    } catch (e) { fs.appendFileSync(path.join(dir, 'console.log'), 'seed: ' + (e && e.stack || e) + '\n'); }
  }
  win.webContents.on('console-message', (e) => { const m = e.message || e; fs.appendFileSync(path.join(dir, 'console.log'), String(m) + '\n'); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  win.show();
  await wait(3000);
  const screens = ['talk', 'avatar', 'mind', 'memory', 'mood', 'journal', 'gate', 'tests', 'settings'];
  for (const sc of screens) {
    win.webContents.send('navigate', sc);
    await wait(sc === 'avatar' || sc === 'talk' ? 9000 : 1500);
    try { const dbg = await win.webContents.executeJavaScript("JSON.stringify({ st: !!(ui.stage && ui.stage.inst), key: ui.stage && ui.stage.key, err: ui.stageError, loading: ui.stageLoading, canvas: (()=>{ const c = document.querySelector('#avatar-host canvas, #talk-host canvas, #mind-face-host canvas'); return c ? [c.width, c.height, c.parentElement.id] : null; })() })"); fs.appendFileSync(path.join(dir, 'console.log'), sc + ' ' + dbg + '\n'); } catch (_) {}
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
app.on('before-quit', () => { quitting = true; if (link) link.stop(); if (mind) mind.stop(); if (journal) journal.close(); });
