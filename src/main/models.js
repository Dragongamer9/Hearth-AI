'use strict';
// Ithil's body models: 3D VRM files and Live2D folders you add, plus the
// drawn (ComfyUI) look. Each model's license is read and shown.
const fs = require('fs');
const path = require('path');
const { newId } = require('./mind/store');

const CUBISM_CORE_URL = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';
const ARCH_CHAN_URL = 'https://critonic3d.gumroad.com/l/cvPoM';

// Read the JSON chunk of a .vrm (glTF binary) to get its name and license.
function readVrmMeta(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(20);
    fs.readSync(fd, head, 0, 20, 0);
    if (head.toString('ascii', 0, 4) !== 'glTF') throw new Error('That file is not a VRM model.');
    const len = head.readUInt32LE(12);
    if (head.toString('ascii', 16, 20) !== 'JSON' || len > 64 * 1024 * 1024) throw new Error('That VRM file looks broken.');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 20);
    const gltf = JSON.parse(buf.toString('utf8'));
    const ext = gltf.extensions || {};
    if (ext.VRMC_vrm) {
      const m = ext.VRMC_vrm.meta || {};
      const lic = m.licenseUrl && /cc0|creativecommons.org\/publicdomain/i.test(m.licenseUrl) ? 'CC0 · free for anything'
        : m.licenseUrl && /vrm.dev\/licenses\/1.0/.test(m.licenseUrl) ? 'VRM license' + (m.commercialUsage && m.commercialUsage !== 'personalNonProfit' ? ' · commercial OK' : ' · personal use')
        : m.licenseUrl ? 'See license link' : 'Check its license';
      return { version: 1, name: m.name || '', authors: (m.authors || []).join(', '), license: lic, licenseUrl: m.licenseUrl || m.otherLicenseUrl || '', permission: m.avatarPermission || '' };
    }
    if (ext.VRM) {
      const m = ext.VRM.meta || {};
      const map = { CC0: 'CC0 · free for anything', CC_BY: 'CC BY', CC_BY_NC: 'CC BY-NC · personal use', CC_BY_SA: 'CC BY-SA', CC_BY_NC_SA: 'CC BY-NC-SA · personal use', CC_BY_ND: 'CC BY-ND', CC_BY_NC_ND: 'CC BY-NC-ND · personal use', Redistribution_Prohibited: 'Don’t share it', Other: 'Check its license' };
      return { version: 0, name: m.title || '', authors: m.author || '', license: map[m.licenseName] || 'Check its license', licenseUrl: m.otherLicenseUrl || '', permission: m.allowedUserName || '' };
    }
    throw new Error('That glTF file has no VRM data. Export it as VRM.');
  } finally { fs.closeSync(fd); }
}

function findModel3(dir, depth) {
  if ((depth || 0) > 3) return null;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return null; }
  const hit = entries.find((e) => e.isFile() && /\.model3\.json$/i.test(e.name));
  if (hit) return path.join(dir, hit.name);
  for (const e of entries) if (e.isDirectory()) { const r = findModel3(path.join(dir, e.name), (depth || 0) + 1); if (r) return r; }
  return null;
}

function findLicense(dir) {
  const walk = (d, depth) => {
    if (depth > 2) return null;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return null; }
    for (const e of entries) if (e.isFile() && /(licen[cs]e|readme|terms|利用規約|規約|copyright)/i.test(e.name) && /\.(txt|md|html?)$|^[^.]+$/i.test(e.name)) return path.join(d, e.name);
    for (const e of entries) if (e.isDirectory()) { const r = walk(path.join(d, e.name), depth + 1); if (r) return r; }
    return null;
  };
  return walk(dir, 0);
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

class Models {
  constructor(store, getName) {
    this.store = store;
    this.getName = getName || (() => 'Ithil');
    this.dir = store.p('models');
    fs.mkdirSync(this.dir, { recursive: true });
    this.list = store.readState('models', []);
  }
  save() { this.store.writeState('models', this.list); }
  get(id) { return this.list.find((m) => m.id === id) || null; }
  abs(m) { return path.join(this.dir, m.id, m.file); }

  importVrm(file) {
    const meta = readVrmMeta(file);
    const id = newId('vrm');
    const dest = path.join(this.dir, id);
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(file, path.join(dest, 'model.vrm'));
    const base = path.basename(file, path.extname(file));
    const name = meta.name || base;
    const mine = new RegExp(this.getName(), 'i').test(name + ' ' + base);
    const arch = /arch[-_ ]?chan/i.test(name + ' ' + base);
    const m = {
      id, kind: 'vrm', file: 'model.vrm', name: arch ? 'Arch-chan 3D' : name,
      kindLabel: arch ? '3D · converted from Blender' : '3D · VRM' + (/vroid/i.test(meta.authors + JSON.stringify(meta)) || mine ? ' · made in VRoid Studio' : ''),
      license: mine ? 'Yours' : arch ? 'CC0 · free for anything' : meta.license,
      licenseUrl: meta.licenseUrl, authors: meta.authors, source: arch ? 'arch-chan' : 'import', at: Date.now()
    };
    this.list.push(m);
    this.save();
    return m;
  }

  // 0.6: any glTF model (.glb, or a .gltf with its files). It plays in the same 3D stage as a VRM; without
  // VRM bones it doesn't pose or make faces, but it breathes, turns and follows her mood.
  importGltf(file) {
    const id = newId('glb');
    const dest = path.join(this.dir, id);
    fs.mkdirSync(dest, { recursive: true });
    let rel;
    if (/\.glb$/i.test(file)) { fs.copyFileSync(file, path.join(dest, 'model.glb')); rel = 'model.glb'; }
    else { copyDir(path.dirname(file), dest); rel = path.basename(file); }
    const lic = findLicense(path.dirname(file));
    const m = { id, kind: 'vrm', plain: true, file: rel, name: path.basename(file, path.extname(file)), kindLabel: '3D · glTF',
      license: lic ? 'License file: ' + path.basename(lic) : 'Check its license', source: 'import', at: Date.now() };
    this.list.push(m);
    this.save();
    return m;
  }

  importLive2d(folderOrFile) {
    const src = fs.statSync(folderOrFile).isDirectory() ? folderOrFile : path.dirname(folderOrFile);
    const model3 = fs.statSync(folderOrFile).isFile() && /\.model3\.json$/i.test(folderOrFile) ? folderOrFile : findModel3(src);
    if (!model3) throw new Error('No Live2D model (.model3.json) in that folder. Hearth AI plays Cubism 3 and 4 models.');
    const id = newId('l2d');
    const dest = path.join(this.dir, id);
    copyDir(src, dest);
    const rel = path.relative(src, model3);
    const lic = findLicense(src);
    let licText = '';
    if (lic) { try { licText = fs.readFileSync(lic, 'utf8').slice(0, 600); } catch (_) {} }
    const m = {
      id, kind: 'live2d', file: rel, name: path.basename(model3).replace(/\.model3\.json$/i, ''),
      kindLabel: 'Live2D · Cubism 3/4', license: lic ? 'License file: ' + path.basename(lic) : 'Check its license',
      licenseFile: lic ? path.relative(src, lic) : null, licenseText: licText, source: 'import', at: Date.now()
    };
    this.list.push(m);
    this.save();
    return m;
  }

  remove(id) {
    const m = this.get(id);
    if (!m) return false;
    // These are copies inside ~/HearthAI, never your original files.
    fs.rmSync(path.join(this.dir, id), { recursive: true, force: true });
    this.list = this.list.filter((x) => x.id !== id);
    this.save();
    return true;
  }

  saveThumb(id, dataUrl) {
    const m = this.get(id);
    if (!m || !/^data:image\/png;base64,/.test(dataUrl || '')) return false;
    fs.writeFileSync(path.join(this.dir, id, 'thumb.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
    m.thumb = 'thumb.png';
    this.save();
    return true;
  }

  coreFile() { return this.store.p('vendor', 'live2dcubismcore.min.js'); }
  async ensureCubismCore() {
    const f = this.coreFile();
    if (fs.existsSync(f)) return f;
    const r = await fetch(CUBISM_CORE_URL);
    if (!r.ok) throw new Error('Couldn’t download the Live2D runtime (' + r.status + ').');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    return f;
  }
}

module.exports = { Models, readVrmMeta, findModel3, findLicense, CUBISM_CORE_URL, ARCH_CHAN_URL };
