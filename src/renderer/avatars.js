'use strict';
// 0.6: her five built-in 3D avatars (Moon orb, Crystal, Humanoid, Wisp, Lantern), drawn with flat-shaded
// triangles on a canvas, no libraries. Taken from the team's mockup (docs/ithil/mockups/ithil-app.html).
// draw(canvas, index, colour, time, { yaw, pitch, needs: { energy, curiosity }, follow, zoom })
window.NxAvatars = (() => {
  const TAU = Math.PI * 2;
  // a mesh is { v:[[x,y,z]], f:[[a,b,c,col,cx,cy,cz]] }; (cx,cy,cz) = local centre used to point normals outward
  function ellipsoid(seg, ring, r, c = [0, 0, 0], col = 0, th0 = 0, th1 = Math.PI) {
    const v = [], f = [];
    for (let i = 0; i <= ring; i++) {
      const th = th0 + (th1 - th0) * i / ring;
      for (let j = 0; j < seg; j++) {
        const ph = j / seg * TAU;
        v.push([c[0] + r[0] * Math.sin(th) * Math.cos(ph), c[1] + r[1] * Math.cos(th), c[2] + r[2] * Math.sin(th) * Math.sin(ph)]);
      }
    }
    for (let i = 0; i < ring; i++) for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + (j + 1) % seg, d = (i + 1) * seg + j, e = (i + 1) * seg + (j + 1) % seg;
      f.push([a, b, d, col, ...c], [b, e, d, col, ...c]);
    }
    return { v, f };
  }
  const sphere = (seg, ring, rad, c, col) => ellipsoid(seg, ring, [rad, rad, rad], c, col);
  function torus(R, r, su, sv, col) {
    const v = [], f = [];
    for (let i = 0; i < su; i++) for (let j = 0; j < sv; j++) {
      const u = i / su * TAU, w = j / sv * TAU;
      v.push([(R + r * Math.cos(w)) * Math.cos(u), r * Math.sin(w), (R + r * Math.cos(w)) * Math.sin(u)]);
    }
    for (let i = 0; i < su; i++) for (let j = 0; j < sv; j++) {
      const a = i * sv + j, b = ((i + 1) % su) * sv + j, d = i * sv + (j + 1) % sv, e = ((i + 1) % su) * sv + (j + 1) % sv;
      const um = (i + 0.5) / su * TAU, cc = [R * Math.cos(um), 0, R * Math.sin(um)];
      f.push([a, b, d, col, ...cc], [b, e, d, col, ...cc]);
    }
    return { v, f };
  }
  function icosa(s = [1, 1, 1], c = [0, 0, 0], col = 0) {
    const t = (1 + Math.sqrt(5)) / 2, n = Math.hypot(1, t);
    const base = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    const v = base.map(p => [c[0] + p[0] / n * s[0], c[1] + p[1] / n * s[1], c[2] + p[2] / n * s[2]]);
    const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    return { v, f: F.map(q => [...q, col, ...c]) };
  }
  function xform(m, fn) { return { v: m.v.map(fn), f: m.f.map(q => { const c = fn([q[4], q[5], q[6]]); return [q[0], q[1], q[2], q[3], c[0], c[1], c[2]]; }) }; }
  const rotX = a => p => [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a)];
  const rotZ = a => p => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]];
  function merge(...ms) {
    const v = [], f = [];
    for (const m of ms) { const o = v.length; v.push(...m.v); for (const q of m.f) f.push([q[0] + o, q[1] + o, q[2] + o, ...q.slice(3)]); }
    return { v, f };
  }

  // ---------- the avatars (original designs) ----------
  const ring = xform(xform(torus(0.98, 0.03, 56, 6, 1), rotX(0.42)), rotZ(0.22));
  const AV = [
    { id: 'orb', name: 'Moon orb', note: 'Her moon, with a slow ring',
      mesh: merge(sphere(26, 16, 0.6, [0, 0, 0], 0), ring) },
    { id: 'crystal', name: 'Crystal', note: 'Faceted, catches the light',
      mesh: merge(icosa([0.5, 0.95, 0.5], [0, 0, 0], 0), icosa([0.12, 0.2, 0.12], [0.75, 0.35, 0.1], 1),
                  icosa([0.09, 0.15, 0.09], [-0.7, -0.3, 0.2], 1), icosa([0.08, 0.12, 0.08], [-0.2, 0.9, -0.5], 1)) },
    { id: 'humanoid', name: 'Humanoid', note: 'Low-poly bust with glowing eyes',
      mesh: merge(
        ellipsoid(22, 14, [0.29, 0.37, 0.31], [0, 0.44, 0], 2),
        ellipsoid(22, 8, [0.33, 0.36, 0.35], [0, 0.5, -0.04], 0, 0, Math.PI * 0.55),
        ellipsoid(14, 8, [0.11, 0.2, 0.11], [0, 0.02, 0], 2),
        ellipsoid(26, 10, [0.72, 0.25, 0.38], [0, -0.42, 0], 0),
        ellipsoid(8, 6, [0.055, 0.035, 0.03], [-0.11, 0.46, 0.28], 1),
        ellipsoid(8, 6, [0.055, 0.035, 0.03], [0.11, 0.46, 0.28], 1),
        sphere(10, 6, 0.06, [0, -0.2, 0.38], 1)) },
    { id: 'wisp', name: 'Wisp', note: 'A bright core with drifting sparks',
      mesh: null, build: t => merge(sphere(18, 12, 0.34, [0, 0, 0], 1), sphere(18, 12, 0.56, [0, 0, 0], 3),
        ...Array.from({ length: 7 }, (_, i) => { const a = t * (0.6 + i * 0.07) + i * TAU / 7, rr = 0.8 + 0.1 * Math.sin(t + i);
          return icosa([0.055, 0.055, 0.055], [Math.cos(a) * rr, 0.35 * Math.sin(a * 1.3 + i), Math.sin(a) * rr], 1); })) },
    { id: 'lantern', name: 'Lantern', note: 'A small light she carries',
      mesh: merge(ellipsoid(8, 8, [0.42, 0.62, 0.42], [0, -0.05, 0], 3), sphere(14, 10, 0.2, [0, -0.05, 0], 1),
                  ellipsoid(8, 4, [0.48, 0.1, 0.48], [0, 0.62, 0], 0), ellipsoid(8, 4, [0.48, 0.1, 0.48], [0, -0.7, 0], 0),
                  xform(torus(0.16, 0.025, 20, 5, 0), p => [p[0], p[2] + 0.84, p[1]])) },
  ];
  const COLS = ['#a78bfa', '#60a5fa', '#2dd4bf', '#f472b6', '#fbbf24', '#e2e8f0'];
  const hex = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
  const MOODS = {
    now: { energy: 0.31, curiosity: 0.72, label: 'energy .31 → slow, calm motion; curious → small head tilts' },
    rested: { energy: 0.9, curiosity: 0.4, label: 'energy .90 → lively motion, brighter glow' },
    tired: { energy: 0.1, curiosity: 0.2, label: 'energy .10 → barely moving, dim glow' },
    curious: { energy: 0.6, curiosity: 0.95, label: 'curiosity .95 → looks around more' },
    sleep: { energy: 0.05, curiosity: 0, label: 'asleep → very slow breathing, low glow' },
  };


  function palette(colHex, glowK) {
    const c = hex(colHex);
    return [
      { c: c.map(x => x * 0.55 + 20), e: 0.15 * glowK, a: 1 },                 // 0 body
      { c: c.map(x => Math.min(255, x * 0.6 + 110)), e: 0.9 * glowK, a: 1 },   // 1 glowing bits
      { c: [196, 190, 214], e: 0.05, a: 1 },                                   // 2 skin / neutral
      { c: c.map(x => Math.min(255, x + 40)), e: 0.4 * glowK, a: 0.22 },       // 3 glass / shell
    ];
  }

  const L = (() => { const l = [-0.45, 0.6, 0.75], n = Math.hypot(...l); return l.map(x => x / n); })();
  function draw(cv, avIdx, colHex, t, opt = {}) {
    const ctx = cv.getContext('2d'), dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    ctx.clearRect(0, 0, w, h);
    const av = AV[avIdx], mesh = av.build ? av.build(t) : av.mesh;
    const m = opt.needs || MOODS[opt.mood || 'rested'] || MOODS.rested, follow = opt.follow !== false;
    const energy = follow ? m.energy : 0.6, curious = follow ? m.curiosity : 0.3;
    const glowK = 0.45 + 0.55 * energy;
    const pal = palette(colHex, glowK);
    const breathe = 1 + 0.025 * Math.sin(t * (0.8 + 1.6 * energy));
    const bob = 0.05 * Math.sin(t * (0.6 + 1.4 * energy)) * (0.3 + energy);
    const yaw = (opt.yaw ?? 0) + 0.35 * curious * Math.sin(t * 0.7);
    const pitch = (opt.pitch ?? 0.1) + 0.08 * curious * Math.sin(t * 0.53 + 1);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const rot = p => { const x = p[0] * breathe, y = p[1] * breathe + bob, z = p[2] * breathe;
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy; return [x1, y * cp - z1 * sp, y * sp + z1 * cp]; };
    const S = Math.min(w, h) * (opt.zoom || 0.36);
    const P = mesh.v.map(rot);
    const proj = p => { const k = 3.2 / (3.2 - p[2]); return [w / 2 + p[0] * S * k, h * 0.5 - p[1] * S * k]; };
    const Q = P.map(proj);
    // glow behind
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, S * 1.5);
    const gc = hex(colHex);
    g.addColorStop(0, `rgba(${gc},${(0.28 * glowK).toFixed(3)})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const faces = [];
    for (const q of mesh.f) {
      const a = P[q[0]], b = P[q[1]], c = P[q[2]];
      let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
      let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const cc = rot([q[4], q[5], q[6]]);
      const mx = (a[0] + b[0] + c[0]) / 3, my = (a[1] + b[1] + c[1]) / 3, mz = (a[2] + b[2] + c[2]) / 3;
      if (nx * (mx - cc[0]) + ny * (my - cc[1]) + nz * (mz - cc[2]) < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const pe = pal[q[3]];
      if (nz <= 0 && pe.a >= 1) continue;               // back face (keep glass back faces)
      faces.push([mz, q, Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]), nz]);
    }
    faces.sort((x, y) => x[0] - y[0]);
    ctx.lineJoin = 'round';
    for (const [, q, dif, nz] of faces) {
      const pe = pal[q[3]];
      const rim = Math.pow(1 - Math.abs(nz), 3) * 0.6 * glowK;
      const k = 0.22 + 0.78 * dif;
      const col = pe.c.map((x, i) => Math.min(255, x * k + x * pe.e + gc[i] * rim) | 0);
      const A = Q[q[0]], B = Q[q[1]], C = Q[q[2]];
      ctx.fillStyle = ctx.strokeStyle = `rgba(${col},${pe.a})`;
      ctx.lineWidth = pe.a < 1 ? 0 : 0.8;
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(C[0], C[1]); ctx.closePath();
      ctx.fill(); if (pe.a >= 1) ctx.stroke();
    }
  }

  const index = (id) => Math.max(0, AV.findIndex((a) => a.id === id));
  return { AV, COLS, MOODS, draw, index };
})();
