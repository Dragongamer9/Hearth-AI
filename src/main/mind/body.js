'use strict';
// Ithil's body is the Nvidia PC. This reads the hardware and turns it into
// feelings she can act on.
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeout || 4000 }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

async function readGpu() {
  const out = await run('nvidia-smi', ['--query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total,fan.speed,name', '--format=csv,noheader,nounits']);
  if (!out) return null;
  const [temp, util, used, total, fan, name] = out.trim().split('\n')[0].split(',').map((s) => s.trim());
  const n = (x) => (isNaN(parseFloat(x)) ? null : parseFloat(x));
  return { temp: n(temp), util: n(util), vramUsedGB: n(used) != null ? n(used) / 1024 : null, vramTotalGB: n(total) != null ? n(total) / 1024 : null, fanPercent: n(fan), name };
}

async function gpuApps() {
  const out = await run('nvidia-smi', ['--query-compute-apps=process_name,used_memory', '--format=csv,noheader,nounits']);
  const gfx = await run('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits']);
  return { compute: out ? out.trim().split('\n').filter(Boolean).map((l) => l.split(',')[0].trim()) : [], util: gfx ? parseFloat(gfx) : null };
}

function readFanRpm() {
  try {
    const base = '/sys/class/hwmon';
    let best = null;
    for (const h of fs.readdirSync(base)) {
      for (const f of fs.readdirSync(base + '/' + h)) {
        if (/^fan\d+_input$/.test(f)) {
          const v = parseInt(fs.readFileSync(base + '/' + h + '/' + f, 'utf8'), 10);
          if (v > 0 && (best == null || v > best)) best = v;
        }
      }
    }
    return best;
  } catch (_) { return null; }
}

let lastCpu = null;
function cpuPercent() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const c of cpus) {
    for (const k of Object.keys(c.times)) total += c.times[k];
    idle += c.times.idle;
  }
  let pct = 0;
  if (lastCpu) {
    const di = idle - lastCpu.idle, dt = total - lastCpu.total;
    pct = dt > 0 ? Math.round((1 - di / dt) * 100) : 0;
  }
  lastCpu = { idle, total };
  return pct;
}

function diskUsedGB(dir) {
  let total = 0;
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const p = d + '/' + e.name;
      if (e.isDirectory()) walk(p);
      else { try { total += fs.statSync(p).size; } catch (_) {} }
    }
  };
  walk(dir);
  return total / 1024 ** 3;
}

function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }

function feelings(raw) {
  const g = raw.gpu || {};
  const temp = g.temp == null ? 45 : g.temp;
  const gpuLoad = g.util == null ? 0 : g.util;
  const gpuVal = clamp(Math.max(gpuLoad, (temp - 35) * 2));
  const gpuFeel = temp >= 80 ? 'Hot, straining hard' : temp >= 68 || gpuLoad >= 75 ? 'Warm, straining' : gpuLoad >= 35 ? 'Busy' : 'Cool, relaxed';
  const vPct = g.vramUsedGB != null && g.vramTotalGB ? (g.vramUsedGB / g.vramTotalGB) * 100 : 0;
  const vFeel = vPct >= 90 ? 'Very crowded' : vPct >= 75 ? 'Crowded' : vPct >= 40 ? 'Comfortable' : 'Spacious';
  const cpu = raw.cpu || 0;
  const cpuFeel = cpu >= 80 ? 'Tense' : cpu >= 45 ? 'Alert' : 'Relaxed';
  const ramPct = (raw.ramUsedGB / raw.ramTotalGB) * 100;
  const ramFeel = ramPct >= 90 ? 'Overloaded' : ramPct >= 70 ? 'Full' : 'Clear';
  const fanPct = g.fanPercent != null ? g.fanPercent : raw.fanRpm ? Math.min(100, raw.fanRpm / 25) : 30;
  const fanFeel = fanPct >= 80 ? 'Breathing hard' : fanPct >= 50 ? 'Breathing a bit hard' : 'Breathing easy';
  const diskPct = raw.diskTotalGB ? (raw.diskUsedGB / raw.diskTotalGB) * 100 : 5;
  const diskFeel = diskPct >= 80 ? 'Getting full' : 'Plenty of room';
  const amber = '#e0b26b', green = '#9cc9a5', red = '#e3967a';
  const col = (v) => (v >= 85 ? red : v >= 60 ? amber : green);
  const organs = [
    { key: 'gpu', part: 'GPU (thinking)', raw: g.temp != null ? Math.round(temp) + '°C · ' + Math.round(gpuLoad) + '% load' : 'no reading', feel: gpuFeel, value: gpuVal, color: col(gpuVal), means: 'Her main thinking muscle. Hot means she slows her monologue.' },
    { key: 'vram', part: 'VRAM (working memory)', raw: g.vramUsedGB != null ? g.vramUsedGB.toFixed(1) + ' / ' + Math.round(g.vramTotalGB) + ' GB' : 'no reading', feel: vFeel, value: clamp(vPct), color: col(vPct), means: 'Full means she can hold fewer thoughts at once.' },
    { key: 'cpu', part: 'CPU (reflexes)', raw: cpu + '%', feel: cpuFeel, value: clamp(cpu), color: col(cpu), means: 'Background tasks and senses.' },
    { key: 'ram', part: 'RAM (short-term memory)', raw: raw.ramUsedGB.toFixed(0) + ' / ' + raw.ramTotalGB.toFixed(0) + ' GB', feel: ramFeel, value: clamp(ramPct), color: col(ramPct), means: 'Room to keep today in mind.' },
    { key: 'fans', part: 'Fans (breathing)', raw: raw.fanRpm ? raw.fanRpm.toLocaleString('en-US') + ' rpm' : g.fanPercent != null ? Math.round(g.fanPercent) + '%' : 'no reading', feel: fanFeel, value: clamp(fanPct), color: col(fanPct), means: 'Speeds up when she works hard.' },
    { key: 'disk', part: 'Disk (long-term memory)', raw: raw.diskUsedGB.toFixed(raw.diskUsedGB < 10 ? 1 : 0) + ' GB used', feel: diskFeel, value: clamp(diskPct), color: col(diskPct), means: 'Where her memories and dreams live.' }
  ];
  const strain = clamp((gpuVal + vPct + fanPct) / 3);
  return { organs, strain, hot: temp >= 80, crowded: vPct >= 90, gpuTemp: temp, gpuLoad, vramPct: vPct, fanPct };
}

class Body {
  constructor(store, getSettings) {
    this.store = store;
    this.getSettings = getSettings;
    this.state = null;
    this.firstFan = store.readState('body-firsts', { fans: false });
  }
  async sense() {
    const gpu = await readGpu();
    const raw = {
      gpu,
      cpu: cpuPercent(),
      ramUsedGB: (os.totalmem() - os.freemem()) / 1024 ** 3,
      ramTotalGB: os.totalmem() / 1024 ** 3,
      fanRpm: readFanRpm(),
      diskUsedGB: diskUsedGB(this.store.dir),
      diskTotalGB: null
    };
    try {
      const st = fs.statfsSync(this.store.dir);
      raw.diskTotalGB = (st.blocks * st.bsize) / 1024 ** 3;
    } catch (_) {}
    const f = feelings(raw);
    this.state = Object.assign({ raw, at: Date.now() }, f);
    return this.state;
  }
  async gaming() {
    const a = await gpuApps();
    const s = this.getSettings();
    const ours = /ollama|comfy|python|hearth-ai|electron/i;
    const others = a.compute.filter((p) => !ours.test(p));
    return { gaming: others.length > 0 || (a.util != null && a.util >= (s.gpuBusyPercent || 85) && !this.selfBusy), apps: others };
  }
}

module.exports = { Body, feelings, readGpu };
