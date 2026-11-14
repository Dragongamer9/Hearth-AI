'use strict';
// Developer helper: give a fake Ithil a day of life so every screen has data.
const { Store } = require('../src/main/mind/store');
const { Settings } = require('../src/main/mind/settings');
const { Rules } = require('../src/main/mind/rules');
const { FakeBrain } = require('../src/main/mind/llm');
const { Mind } = require('../src/main/mind/engine');
const { feelings } = require('../src/main/mind/body');
(async () => {
  const store = new Store(process.env.HEARTH_AI_HOME);
  const settings = new Settings(store);
  const rules = new Rules(store);
  let t = Date.now() - 26 * 3600000;
  const body = { state: null, firstFan: { fans: false }, async sense() { this.state = feelings({ gpu: { temp: 71, util: 84, vramUsedGB: 9.8, vramTotalGB: 12, fanPercent: 58 }, cpu: 22, ramUsedGB: 14, ramTotalGB: 32, fanRpm: 1450, diskUsedGB: 0.4, diskTotalGB: 1800 }); return this.state; }, async gaming() { return { gaming: false, apps: [] }; } };
  const mind = new Mind({ store, brain: new FakeBrain(), settings, rules, body, hooks: { idleSeconds: () => 9999 }, now: () => t });
  for (let i = 0; i < 6; i++) { await mind.tick(); t += 60000; }
  await mind.consider({ type: 'task', goal: 'Write some notes about the guard pathing' });
  t += 60000; await mind.tick();
  await mind.talk('Hey, what have you been up to while I was at work?');
  await mind.act({ type: 'wish', text: 'Can I have a sight sense, screenshots of my own window, so I can see what I look like to you?', effect: 'enable_sight' }, { id: 'x' });
  await mind.maybeFreeTime(t, true);
  t += 3 * 3600000;
  await mind.sleep();
  t = Date.now() - 600000;
  await mind.consider({ type: 'task', goal: 'Fix the guard pathing she got wrong' });
  for (let i = 0; i < 3; i++) { await mind.tick(); t += 120000; }
  mind.save();
  console.log('seeded', store.dir);
})();
