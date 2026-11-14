'use strict';
// The user's settings. Saved to disk on every change and never changed by
// Ithil herself: the mind only ever reads them.

const DEFAULTS = {
  ollamaUrl: 'http://127.0.0.1:11434',
  chatModel: 'huihui_ai/qwen3-abliterated:8b-v2',
  uncensored: true,
  embedModel: 'nomic-embed-text',
  visionModel: 'huihui_ai/qwen3-vl-abliterated:8b',
  comfyUrl: 'http://127.0.0.1:8188',
  comfyCheckpoint: '',
  sleepTime: '06:10',
  freeTimeMinutes: 120,
  thinkEverySeconds: 45,
  autostart: true,
  startHidden: true,
  unloadWhenGaming: true,
  gpuBusyPercent: 85,
  notifyBeforeSwitchOff: false,
  allowCommandCenter: true,
  allowLanConnections: false,
  growWhileSleeping: true,
  growEveryDays: 3,
  hfToken: '',
  senses: { hardware: true, time: true, hearing: true, sight: false, presence: false, body: true },
  avatar: {
    bodyType: 'vrm',
    modelId: null,
    camera: 'full',
    scene: 'moon',
    smooth: true,
    faces: {},
    buddyPose: 'stand',
    style: 'Anime',
    framing: 'full',
    roster: 'Moonlit',
    hair: 'Silver, long',
    eyes: 'Pale blue',
    outfit: 'Dark cloak, moon pin',
    nightOutfit: 'Same as day',
    accent: 'Hearth sage',
    letHerSuggest: true,
    voice: 'soft',
    places: { talk: true, buddy: true, mind: true, commandCenter: false }
  }
};

function merge(base, over) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object') out[k] = merge(base[k], over[k]);
    else out[k] = over[k];
  }
  return out;
}

class Settings {
  constructor(store) {
    this.store = store;
    this.value = merge(DEFAULTS, store.readState('settings', {}));
    // Save immediately so the file always holds every setting.
    store.writeState('settings', this.value);
  }
  get() { return this.value; }
  // Only called from the user's UI.
  setByUser(patch) {
    this.value = merge(this.value, patch || {});
    this.store.writeState('settings', this.value);
    return this.value;
  }
}

module.exports = { Settings, DEFAULTS, merge };
