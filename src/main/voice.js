'use strict';
// Ithil's voice (Kokoro) and hearing (Whisper). Both run locally on the PC;
// the models download once into ~/HearthAI/models.
const path = require('path');

const VOICES = {
  soft: { name: 'Soft & calm', what: 'Warm, a little quiet', id: 'af_heart' },
  bright: { name: 'Bright & quick', what: 'Energetic, playful', id: 'af_bella' },
  low: { name: 'Low & dry', what: 'Deadpan, relaxed', id: 'af_nicole' }
};

class Voice {
  constructor(modelDir) {
    this.modelDir = modelDir;
    this.tts = null;
    this.stt = null;
    this.loadingTts = null;
    this.loadingStt = null;
    this.error = null;
  }
  async _env() {
    const t = await import('@huggingface/transformers');
    t.env.cacheDir = this.modelDir;
    t.env.allowLocalModels = true;
    return t;
  }
  async loadTts() {
    if (this.tts) return this.tts;
    if (!this.loadingTts) {
      this.loadingTts = (async () => {
        await this._env();
        const { KokoroTTS } = await import('kokoro-js');
        this.tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
        return this.tts;
      })().catch((e) => { this.loadingTts = null; this.error = String(e.message || e); throw e; });
    }
    return this.loadingTts;
  }
  async loadStt() {
    if (this.stt) return this.stt;
    if (!this.loadingStt) {
      this.loadingStt = (async () => {
        const t = await this._env();
        this.stt = await t.pipeline('automatic-speech-recognition', 'onnx-community/whisper-base.en', { dtype: 'q8', device: 'cpu' });
        return this.stt;
      })().catch((e) => { this.loadingStt = null; this.error = String(e.message || e); throw e; });
    }
    return this.loadingStt;
  }
  // Her tone shifts with her mood: slower when tired, faster when excited.
  speedFor(drives) {
    if (!drives) return 1;
    if (drives.energy < 35) return 0.88;
    if (drives.curiosity > 80 || drives.satisfaction > 75) return 1.1;
    return 1;
  }
  volumeFor(drives) {
    if (!drives) return 1;
    return drives.energy < 35 ? 0.75 : 1;
  }
  async speak(text, voiceKey, drives) {
    const tts = await this.loadTts();
    const v = VOICES[voiceKey] || VOICES.soft;
    const audio = await tts.generate(String(text).slice(0, 1200), { voice: v.id, speed: this.speedFor(drives) });
    return { wav: Buffer.from(audio.toWav()), volume: this.volumeFor(drives) };
  }
  // pcm: Float32Array at 16 kHz
  async hear(pcm) {
    const stt = await this.loadStt();
    const r = await stt(pcm);
    return String((r && r.text) || '').trim();
  }
}

module.exports = { Voice, VOICES };
