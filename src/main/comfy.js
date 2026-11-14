'use strict';
// Draws Ithil's portrait, expressions, dreams and free-time pictures with the
// ComfyUI already running on the Nvidia PC.
const fs = require('fs');
const path = require('path');

const STYLE = {
  'Anime': 'anime style illustration, clean lineart, soft cel shading, detailed eyes',
  'Semi-real': 'semi-realistic digital painting, soft lighting, painterly, detailed face',
  '3D': '3d render, stylized character, soft global illumination, pixar-like',
  'Moon orb': ''
};
const EXPR = {
  calm: 'calm gentle expression, relaxed', curious: 'curious expression, head slightly tilted, wide eyes', happy: 'happy warm smile',
  focused: 'focused determined expression, slight frown of concentration', frustrated: 'frustrated expression, furrowed brow, small pout',
  sleepy: 'sleepy drowsy expression, half-closed eyes', thinking: 'thoughtful expression, looking slightly up, hand near chin',
  blink: 'calm gentle expression, eyes closed', talking: 'calm expression, mouth slightly open as if talking'
};
const ROSTER = {
  Moonlit: { hair: 'Silver, long', eyes: 'Pale blue', outfit: 'Dark cloak, moon pin' },
  Scholar: { hair: 'Chestnut, braided', eyes: 'Amber', outfit: 'Brown scholar coat, round glasses' },
  Ranger: { hair: 'Dark green, short', eyes: 'Forest green', outfit: 'Green ranger hood and leather vest' },
  Tinkerer: { hair: 'Pink, messy bun', eyes: 'Violet', outfit: 'Work apron with tools, goggles on head' }
};
const NEG = 'lowres, bad anatomy, bad hands, text, watermark, signature, blurry, deformed, extra fingers, nsfw, nude';

class Comfy {
  constructor(getSettings) { this.getSettings = getSettings; this.busy = false; }
  get url() { return (this.getSettings().comfyUrl || 'http://127.0.0.1:8188').replace(/\/$/, ''); }
  async available() {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3000);
      const r = await fetch(this.url + '/system_stats', { signal: ctl.signal }); clearTimeout(t);
      return r.ok;
    } catch (_) { return false; }
  }
  async checkpoints() {
    try {
      const r = await fetch(this.url + '/object_info/CheckpointLoaderSimple');
      const j = await r.json();
      return j.CheckpointLoaderSimple.input.required.ckpt_name[0] || [];
    } catch (_) { return []; }
  }
  async checkpoint() {
    const s = this.getSettings();
    if (s.comfyCheckpoint) return s.comfyCheckpoint;
    const list = await this.checkpoints();
    const pick = list.find((n) => /xl|pony|illustrious|anime/i.test(n)) || list[0];
    if (!pick) throw new Error('ComfyUI has no image checkpoints. Pick one in Settings.');
    return pick;
  }
  workflow(ckpt, prompt, o) {
    const w = o.width || 832, h = o.height || 1216;
    return {
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: 1 } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: o.negative || NEG, clip: ['4', 1] } },
      '3': { class_type: 'KSampler', inputs: { seed: o.seed == null ? Math.floor(Math.random() * 1e12) : o.seed, steps: o.steps || 28, cfg: 6.5, sampler_name: 'euler_ancestral', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'hearth-ai', images: ['8', 0] } }
    };
  }
  async run(prompt, o) {
    const ckpt = await this.checkpoint();
    const r = await fetch(this.url + '/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: this.workflow(ckpt, prompt, o || {}), client_id: 'hearth-ai' }) });
    if (!r.ok) throw new Error('ComfyUI refused the drawing: ' + (await r.text()).slice(0, 200));
    const { prompt_id } = await r.json();
    const deadline = Date.now() + 6 * 60000;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 1500));
      const h = await (await fetch(this.url + '/history/' + prompt_id)).json();
      const entry = h[prompt_id];
      if (!entry) continue;
      for (const node of Object.values(entry.outputs || {})) {
        const img = node.images && node.images[0];
        if (img) {
          const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
          const buf = Buffer.from(await (await fetch(this.url + '/view?' + q)).arrayBuffer());
          return buf;
        }
      }
      if (entry.status && entry.status.status_str === 'error') throw new Error('ComfyUI hit an error while drawing.');
    }
    throw new Error('ComfyUI took too long.');
  }
  // Draw anything (dreams, free-time pictures). Returns the saved file path.
  async draw(prompt, fileName, dir, o) {
    this.busy = true;
    try {
      const buf = await this.run('masterpiece, best quality, ' + prompt, Object.assign({ width: 768, height: 768 }, o || {}));
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, fileName);
      fs.writeFileSync(file, buf);
      return file;
    } finally { this.busy = false; }
  }
  avatarPrompt(av, expr, night) {
    const outfit = night && av.nightOutfit && av.nightOutfit !== 'Same as day' ? av.nightOutfit : av.outfit;
    return ['masterpiece, best quality', STYLE[av.style] || STYLE.Anime, '1girl, solo, upper body portrait, looking at viewer',
      'named Ithil, ' + av.hair + ' hair, ' + av.eyes + ' eyes, wearing ' + outfit,
      EXPR[expr] || EXPR.calm, 'moonlit night background, soft rim light, accent color ' + av.accent].join(', ');
  }
  // Draw her whole face set with one seed so she stays the same person.
  async drawAvatar(av, dir, onProgress) {
    if (av.style === 'Moon orb') return [];
    this.busy = true;
    const seed = Math.floor(Math.random() * 1e12);
    const out = [];
    try {
      fs.mkdirSync(dir, { recursive: true });
      const keys = Object.keys(EXPR);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (onProgress) onProgress(i, keys.length, k);
        const buf = await this.run(this.avatarPrompt(av, k), { seed, width: 832, height: 1216 });
        const file = path.join(dir, k + '.png');
        fs.writeFileSync(file, buf);
        out.push(file);
      }
      fs.writeFileSync(path.join(dir, 'look.json'), JSON.stringify({ av, seed, at: Date.now() }, null, 2));
      return out;
    } finally { this.busy = false; }
  }
}

module.exports = { Comfy, ROSTER, STYLE, EXPR };
