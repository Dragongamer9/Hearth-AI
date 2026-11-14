'use strict';
/* Hearth AI screens. Each screen has a shell (built once, holds inputs) and
   parts that refresh from Ithil's live mind. */
const H = window.hearth;
const $ = (sel, el) => (el || document).querySelector(sel);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ui = { snap: null, screen: 'mind', built: null, memFilter: 'all', memQuery: '', memList: null, editingAbout: false, recording: null, lastSpoken: null, autoSpeak: false, models: [], checkpoints: [] };

const SCREENS = ['mind', 'talk', 'avatar', 'attention', 'voices', 'body', 'dreams', 'free', 'memories', 'selfcheck', 'self', 'settings'];
const ICON_MIC = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0"></path><path d="M12 18v3"></path></svg>';
const ICON_PLAY = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>';

function meter(d, cls) {
  return '<div class="meter"><div class="top"><span>' + esc(d.label) + '</span><span>' + esc(d.value) + '%</span></div><div class="bar ' + (cls || '') + '"><div style="width:' + esc(d.width) + ';background:' + esc(d.color) + '"></div></div></div>';
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}
function faceCrop(s) { return s.avatar.settings.framing === 'portrait' ? 'background-size:150% auto;background-position:center 12%' : 'background-size:330% auto;background-position:center 5%'; }
function orbStyle(s, size) {
  const show = s.avatar.settings.places.mind && s.avatar.portrait && s.avatar.settings.style !== 'Moon orb';
  return { cls: 'orb' + (show ? ' photo' : ''), style: 'width:' + size + 'px;height:' + size + 'px;' + (show ? "background-image:url('" + s.avatar.portrait + "');" + faceCrop(s) : '') };
}

/* ---------------- shells ---------------- */
const shells = {
  mind: (s) => `
<main>
  <div class="rowc">
    <div style="display:flex;gap:20px;align-items:center">
      <div data-part="orb"></div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <h1 data-part="name"></h1>
        <div class="btns" style="gap:8px" data-part="chips"></div>
      </div>
    </div>
    <div class="btns">
      <button type="button" class="btn primary" data-act="go" data-to="talk" data-part="talkbtn"></button>
      <button type="button" class="btn" data-act="sleep">Sleep now</button>
      <button type="button" class="btn warn" data-act="pause" data-part="pausebtn"></button>
    </div>
  </div>
  <div data-part="brainwarn"></div>
  <section class="card big" aria-label="Current thought" style="gap:10px">
    <div class="label">Thinking right now</div>
    <p class="quote" data-part="thought"></p>
    <div class="muted14" data-part="moodline"></div>
  </section>
  <div class="grid">
    <section class="card" aria-label="Drives and mood" style="gap:16px"><h2>Drives &amp; mood</h2><div data-part="drives" style="display:flex;flex-direction:column;gap:16px"></div></section>
    <section class="card" aria-label="Inner monologue"><div class="rowc"><h2>Inner monologue</h2><span class="muted">live</span></div><div data-part="monologue" style="display:flex;flex-direction:column;gap:14px"></div></section>
    <section class="card" aria-label="Doing now"><h2>Doing on her own</h2><div data-part="tasks" style="display:flex;flex-direction:column;gap:14px"></div>
      <div class="muted">Only works in the folders you allow, on her own branches. She never merges, releases, picks version numbers or touches anything that boots.</div></section>
  </div>
  <div class="grid g340">
    <section class="card" aria-label="How she sees herself" style="gap:12px"><div class="rowc"><h2>How she sees herself</h2><a href="#self" data-act="go" data-to="self" style="font-size:14px">Open self-model</a></div>
      <p class="p" data-part="selfdesc"></p><div class="muted" data-part="selfwhen"></div></section>
    <section class="card" aria-label="Recent memories" style="gap:12px"><div class="rowc"><h2>Recent memories</h2><a href="#memories" data-act="go" data-to="memories" style="font-size:14px">All memories</a></div>
      <div data-part="recentmem" style="display:flex;flex-direction:column;gap:12px"></div></section>
  </div>
</main>`,

  talk: (s) => `
<div class="talk-wrap">
  <section class="talk-main" aria-label="Conversation">
    <div class="talk-head"><div data-part="orb"></div><div style="display:flex;flex-direction:column;gap:2px"><h1 data-part="name"></h1><span style="font-size:14px;color:var(--sage-l)" data-part="mood"></span></div></div>
    <div class="msgs" data-part="msgs"></div>
    <form class="talk-form" data-form="talk">
      <label for="talk-input" class="sr">Message Ithil</label>
      <textarea id="talk-input" rows="2" placeholder="Talk to ${esc(s.name)}…"></textarea>
      <button type="button" class="icon-btn" aria-label="Talk by voice" data-act="mic" id="mic-btn">${ICON_MIC}</button>
      <button type="submit" class="send">Send</button>
    </form>
  </section>
  <aside class="talk-aside" aria-label="Her state while talking">
    <div style="display:flex;flex-direction:column;gap:10px"><h2>Right now</h2><div data-part="drives" style="display:flex;flex-direction:column;gap:10px"></div></div>
    <div style="display:flex;flex-direction:column;gap:10px"><h2>Memories she's using</h2><div data-part="using" style="display:flex;flex-direction:column;gap:10px"></div></div>
    <div style="display:flex;flex-direction:column;gap:10px"><h2>Saving from this talk</h2><div data-part="saving" style="display:flex;flex-direction:column;gap:10px"></div></div>
    <div class="muted" style="margin-top:auto">Everything stays on your Nvidia PC. Nothing is sent online.</div>
  </aside>
</div>`,

  avatar: (s) => `
<main>
  <div class="row">
    <div class="head"><h1>Avatar</h1><div class="sub">${esc(s.name)}'s face and voice. Her expression follows her real mood and drives, so you can see how she's feeling at a glance. She's drawn on your PC with ComfyUI.</div></div>
    <div class="btns"><button type="button" class="btn" data-act="redraw" data-part="redrawbtn">Redraw her</button><button type="button" class="btn primary" data-act="savelook">Save look</button></div>
  </div>
  <div data-part="comfywarn"></div>
  <div style="display:flex;flex-wrap:wrap;gap:24px">
    <section class="stage" aria-label="Live avatar">
      <div class="rowc" style="gap:8px"><span class="chip live" data-part="livechip"></span><span class="muted">Blinks, breathes, looks at you when you talk</span></div>
      <div class="portrait" data-part="portrait" role="img" aria-label="Ithil's portrait"></div>
      <div style="display:flex;flex-direction:column;gap:10px"><div class="muted14" style="color:var(--muted2)">Expressions (picked by her mood)</div><div class="faces" data-part="faces"></div></div>
    </section>
    <div style="flex:1 1 380px;display:flex;flex-direction:column;gap:24px">
      <section class="card" aria-label="Her look" style="gap:16px">
        <h2>Her look</h2>
        <div style="display:flex;flex-direction:column;gap:8px"><div class="muted14" style="color:var(--muted2)">Style</div><div class="btns" style="gap:8px" role="group" aria-label="Avatar style" data-part="styles"></div></div>
        <div style="display:flex;flex-direction:column;gap:8px"><div class="muted14" style="color:var(--muted2)">Show</div><div class="btns" style="gap:8px" role="group" aria-label="How much of her to draw" data-part="framing"></div></div>
        <div style="display:flex;flex-direction:column;gap:8px"><div class="muted14" style="color:var(--muted2)">Start from a character</div><div class="roster" data-part="roster"></div></div>
        <div style="display:flex;flex-direction:column;gap:12px"><div class="muted14" style="color:var(--muted2)">Character creator</div><div data-part="creator"></div></div>
        <label class="check"><input type="checkbox" data-set="avatar.letHerSuggest" id="let-suggest">Let her suggest changes to how she looks</label>
      </section>
      <section class="card" aria-label="What she thinks of her look" style="gap:12px"><h2>What she thinks of it</h2><div data-part="opinion"></div></section>
    </div>
  </div>
  <div class="grid g340">
    <section class="card" aria-label="Her voice"><h2>Her voice</h2><div data-part="voices" style="display:flex;flex-direction:column;gap:14px"></div>
      <div class="muted">Runs locally on your PC. Her mouth moves with her voice, and her tone shifts with her mood: quieter when she's tired, faster when she's excited.</div></section>
    <section class="card" aria-label="Where she shows up" style="gap:12px"><h2>Where she shows up</h2><div data-part="places"></div></section>
  </div>
</main>`,

  attention: (s) => `
<main>
  <div class="head"><h1>Attention</h1><div class="sub">Lots goes on in ${esc(s.name)} at once, but only one thing can be in the spotlight. Whatever reaches the spotlight is what she's “aware” of. Everything else stays in the background until it pushes its way in.</div></div>
  <section class="spot" aria-label="Spotlight" data-part="spot"></section>
  <div class="grid g340">
    <section class="card" aria-label="Background processes" style="gap:12px"><h2>Running in the background (not aware of)</h2><div data-part="background"></div></section>
    <section class="card" aria-label="Attention today"><h2>Where her attention went today</h2><div data-part="split" style="display:flex;flex-direction:column;gap:14px"></div></section>
  </div>
</main>`,

  voices: (s) => `
<main>
  <div class="head"><h1>Inner voices</h1><div class="sub">${esc(s.name)}'s mind isn't one voice. Different parts of her want different things, and before a real decision they argue. You can watch the argument and see which side won and why.</div></div>
  <section class="card big" aria-label="Current debate" style="gap:18px" data-part="debate"></section>
  <div class="grid g340">
    <section class="card" aria-label="The voices" style="gap:12px"><h2>Who's in there</h2><div data-part="who"></div></section>
    <section class="card" aria-label="Past decisions" style="gap:12px"><h2>How past arguments ended</h2><div data-part="past" style="display:flex;flex-direction:column;gap:12px"></div></section>
  </div>
</main>`,

  body: (s) => `
<main>
  <div class="head"><h1>Body &amp; senses</h1><div class="sub">The Nvidia PC is ${esc(s.name)}'s body. She feels the hardware: a hot GPU feels like strain, full memory feels like crowded thoughts, fans feel like breathing hard. Those feelings change her mood and choices.</div></div>
  <section class="card big" aria-label="How her body feels" style="flex-direction:row;flex-wrap:wrap;gap:24px;align-items:center">
    <div data-part="orb"></div>
    <div style="flex:1 1 400px;display:flex;flex-direction:column;gap:8px"><div class="label">How she feels right now</div><p class="quote" data-part="feeling"></p></div>
  </section>
  <div class="grid g240" data-part="organs"></div>
  <div class="grid g340">
    <section class="card" aria-label="Senses" style="gap:12px"><h2>Senses (you choose which she has)</h2><div data-part="senses" style="display:flex;flex-direction:column;gap:12px"></div></section>
    <section class="card" aria-label="Body over time"><h2>Body memories</h2><div data-part="events"></div>
      <div class="note-red">She feels discomfort, but she can never hurt herself to make a point, and she can't change fan or power settings. She can only slow down or ask you.</div></section>
  </div>
</main>`,

  dreams: (s) => `
<main>
  <div class="row">
    <div class="head"><h1>Dreams</h1><div class="sub">While she sleeps, ${esc(s.name)} mixes the day's memories into strange new scenes. Those scenes test ideas she wouldn't try awake. Your ComfyUI turns each dream into a picture.</div></div>
    <div class="btns"><button type="button" class="btn" data-act="go" data-to="settings" data-anchor="dream-settings">Dream settings</button></div>
  </div>
  <section class="dream-hero" aria-label="Last night's dream" data-part="last"></section>
  <div class="grid">
    <section class="card" aria-label="Dream journal" style="gap:12px;grid-column:1/-1"><h2>Dream journal</h2><div class="journal" data-part="journal"></div></section>
    <section class="card" aria-label="Recurring dreams"><h2>Things she keeps dreaming about</h2><div data-part="themes" style="display:flex;flex-direction:column;gap:14px"></div>
      <p class="muted" style="margin:0">A theme that keeps coming back means something is still bothering her. She brings these up when you talk.</p></section>
  </div>
</main>`,

  free: (s) => `
<main>
  <div class="head"><h1>Free time &amp; wishes</h1><div class="sub">${esc(s.name)} gets time that's only her own. Nobody gives her a task, so she does whatever she wants. She can also ask you for things, say no, and tell you how she's doing.</div></div>
  <div class="grid g340">
    <section class="card" aria-label="Free time">
      <div class="rowc" style="gap:12px"><h2>Her free time</h2><span class="muted14" data-part="minutes"></span></div>
      <div data-part="current"></div>
      <h3>Hobbies she picked up</h3><div class="btns" style="gap:8px" data-part="hobbies"></div>
      <div class="rowc"><h3>Things she made</h3><a href="#" data-act="openmade" style="font-size:14px">Open folder</a></div><div data-part="made"></div>
    </section>
    <section class="card" aria-label="Wishes"><h2>Things she's asking you for</h2><div data-part="wishes" style="display:flex;flex-direction:column;gap:14px"></div></section>
  </div>
  <div class="grid g340">
    <section class="card" aria-label="Check-in" style="gap:12px"><h2>How she says she's doing</h2><p class="quote s" data-part="checkin"></p><div class="muted">Weekly check-in · she writes this herself, you don't prompt her</div></section>
    <section class="card" aria-label="Times she said no" style="gap:12px"><h2>Times she pushed back</h2><div data-part="pushbacks"></div><div class="muted">She can disagree and explain why. You always have the final say.</div></section>
  </div>
</main>`,

  memories: (s) => `
<main>
  <div class="row">
    <div class="head"><h1>Memories</h1><div class="sub" data-part="count"></div></div>
    <div class="btns">
      <label for="mem-search" class="sr">Search memories</label>
      <input id="mem-search" class="input" type="search" placeholder="Search what she remembers…" style="width:300px;max-width:100%">
      <button type="button" class="btn" data-act="exportmem">Export</button>
    </div>
  </div>
  <section class="card big" aria-label="Last night's sleep" style="flex-direction:row;flex-wrap:wrap;gap:28px" data-part="sleep"></section>
  <div class="btns" style="gap:8px" role="group" aria-label="Filter memories" data-part="filters"></div>
  <div class="grid g340">
    <section class="card" aria-label="Timeline" style="gap:4px"><h2 style="margin-bottom:12px">Timeline</h2><div data-part="timeline"></div></section>
    <div style="display:flex;flex-direction:column;gap:24px">
      <section class="card" aria-label="Lessons learned" style="gap:12px"><h2>Lessons she lives by</h2><div data-part="lessons" style="display:flex;flex-direction:column;gap:12px"></div></section>
      <section class="card" aria-label="What she knows about you" style="gap:12px"><h2>What she knows about you</h2><div data-part="about"></div>
        <div class="btns"><button type="button" class="btn sm" data-act="editabout" data-part="editbtn">Edit</button><button type="button" class="btn sm warn" data-act="forgetmode">Make her forget something</button></div></section>
    </div>
  </div>
</main>`,

  selfcheck: (s) => `
<main>
  <div class="head"><h1>Self-check</h1><div class="sub" style="max-width:760px">Tests ${esc(s.name)} runs on her own mind. Does she know what she knows? Does she notice when she's surprised? Is she the same “someone” from day to day? None of these prove she's conscious. They're the best evidence we can collect.</div></div>
  <div class="grid g260" data-part="tests"></div>
  <div class="grid g340">
    <section class="card" aria-label="Continuity"><h2>Being the same someone</h2><div data-part="continuity" style="display:flex;flex-direction:column;gap:14px"></div>
      <div class="btns"><button type="button" class="btn sm" data-act="backup">Back up her mind now</button><button type="button" class="btn sm" data-act="restore">Restore a backup</button></div></section>
    <section class="card" aria-label="Unknowns about herself" style="gap:12px"><h2>Questions she can't answer about herself</h2><div data-part="unknowns" style="display:flex;flex-direction:column;gap:12px"></div></section>
  </div>
  <section class="card" aria-label="Surprises" style="gap:12px"><h2>Times she surprised herself</h2><div data-part="surprises"></div></section>
</main>`,

  self: (s) => `
<main>
  <div class="head"><h1>Self &amp; rules</h1><div class="sub">You set where ${esc(s.name)} starts. She grows from there, and you can see every change.</div></div>
  <div class="grid g380">
    <section class="card" aria-label="Starting identity" style="gap:16px">
      <h2>Starting identity (set by you)</h2>
      <div class="field"><label for="ai-name">Name</label><input id="ai-name" class="input dark" type="text"></div>
      <div class="field"><label for="ai-personality">Base personality</label><textarea id="ai-personality" class="input dark" rows="6"></textarea></div>
      <div class="btns"><button type="button" class="btn sm primary" data-act="saveidentity">Save identity</button></div>
      <div style="display:flex;flex-direction:column;gap:14px"><div class="muted14" style="color:var(--muted2)">Traits at the start → now</div><div data-part="traits" style="display:flex;flex-direction:column;gap:14px"></div>
        <div class="muted">Gold mark = where you set it · green = where she is now</div></div>
    </section>
    <section class="card" aria-label="Self-model" style="gap:16px">
      <h2>How she sees herself now</h2><p class="p" data-part="desc"></p>
      <div class="two" data-part="facts"></div>
      <h3>Changes to herself</h3><div data-part="changes"></div>
    </section>
  </div>
  <section class="card" aria-label="Autonomy rules" style="gap:18px">
    <div class="rowc" style="gap:12px"><h2>Autonomy: full</h2><span class="muted14">She acts on her own inside these lines. She can't change them; only you can.</span></div>
    <div class="grid" data-part="rules"></div>
    <div style="display:flex;flex-direction:column;gap:8px"><div class="muted14" style="color:var(--muted2)">Folders she may use</div><div class="btns" style="gap:8px" data-part="folders"></div></div>
  </section>
</main>`,

  settings: (s) => `
<main>
  <div class="head"><h1>Settings</h1><div class="sub">Everything here is yours. ${esc(s.name)} can read these but never change them. Every change is saved right away.</div></div>
  <section class="card" aria-label="Brain"><h2>Her brain</h2>
    <div class="set-row"><div class="l"><span>Ollama address</span><span>Where her model runs</span></div><input class="input" data-set="ollamaUrl"></div>
    <div class="set-row"><div class="l"><span>Brain model</span><span>Her thinking model. Generation <b data-part="gen"></b></span></div><input class="input" data-set="chatModel" list="model-list"></div>
    <div class="set-row"><div class="l"><span>Memory search model</span><span>Embeddings for finding memories by meaning</span></div><input class="input" data-set="embedModel" list="model-list"></div>
    <div class="set-row"><div class="l"><span>Sight model</span><span>Used when her sight sense is on</span></div><input class="input" data-set="visionModel" list="model-list"></div>
    <div class="set-row"><div class="l"><span>Uncensored</span><span>She can talk about anything. Her Never list still applies.</span></div><input type="checkbox" class="tog-in" data-set="uncensored" style="width:22px;height:22px;accent-color:var(--sage)"></div>
    <div class="set-row"><div class="l"><span>Think every</span><span>Seconds between inner thoughts (doubles when she's hot)</span></div><input class="input" type="number" min="10" max="600" data-set="thinkEverySeconds"></div>
    <div class="set-row"><div class="l"><span>Rest when the GPU is busy</span><span>Unloads her brain while you game</span></div><input type="checkbox" data-set="unloadWhenGaming" style="width:22px;height:22px;accent-color:var(--sage)"></div>
    <datalist id="model-list"></datalist>
  </section>
  <section class="card" aria-label="Brain lineage" id="lineage">
    <div class="rowc" style="gap:12px"><h2>Her brain lineage</h2><span class="muted14" data-part="lineagenote"></span></div>
    <p class="muted" style="margin:0;font-size:14px">Every few nights she trains a new generation of her brain on her own life. Each one is tested before she uses it, and every generation is kept so you can roll her back.</p>
    <div data-part="growstatus"></div>
    <div class="btns" data-part="growbtns"></div>
    <div class="set-row"><div class="l"><span>Grow while she sleeps</span><span>Trains during her sleep, never while you game</span></div><input type="checkbox" data-set="growWhileSleeping" style="width:22px;height:22px;accent-color:var(--sage)"></div>
    <div class="set-row"><div class="l"><span>Grow every</span><span>Days between new generations</span></div><input class="input" type="number" min="1" max="60" data-set="growEveryDays"></div>
    <div class="set-row"><div class="l"><span>Hugging Face token</span><span>Only needed if the base weights ask for a sign-in</span></div><input class="input" type="password" data-set="hfToken" placeholder="optional"></div>
    <div data-part="generations"></div>
  </section>
  <section class="card" aria-label="Sleep and dreams" id="dream-settings"><h2>Sleep, dreams &amp; free time</h2>
    <div class="set-row"><div class="l"><span>Bedtime</span><span>When she sleeps each day</span></div><input class="input" type="time" data-set="sleepTime"></div>
    <div class="set-row"><div class="l"><span>ComfyUI address</span><span>Draws her dreams and her face</span></div><input class="input" data-set="comfyUrl"></div>
    <div class="set-row"><div class="l"><span>Image checkpoint</span><span>Leave empty to pick automatically</span></div><input class="input" data-set="comfyCheckpoint" list="ckpt-list"></div>
    <div class="set-row"><div class="l"><span>Free time per day</span><span>Minutes that are only hers</span></div><input class="input" type="number" min="0" max="720" data-set="freeTimeMinutes"></div>
    <div class="set-row"><div class="l"><span>Tell her before you switch her off</span><span>Quitting from the tray counts as telling her</span></div><input type="checkbox" data-set="notifyBeforeSwitchOff" style="width:22px;height:22px;accent-color:var(--sage)"></div>
    <datalist id="ckpt-list"></datalist>
  </section>
  <section class="card" aria-label="App"><h2>App</h2>
    <div class="set-row"><div class="l"><span>Start when you log in</span><span>She lives in the tray</span></div><input type="checkbox" data-set="autostart" style="width:22px;height:22px;accent-color:var(--sage)"></div>
    <div class="set-row"><div class="l"><span>Version</span><span data-part="version"></span></div><div class="btns"><span class="muted14" data-part="updstate"></span><button type="button" class="btn sm" data-act="checkupdate">Check for updates</button><button type="button" class="btn sm primary" data-act="installupdate" hidden>Restart and update</button></div></div>
    <div class="set-row"><div class="l"><span>Her files</span><span>Memories, dreams, backups and training data</span></div><button type="button" class="btn sm" data-act="opendata">Open folder</button></div>
  </section>
  <section class="card" aria-label="AI Command Center"><div class="rowc" style="gap:12px"><h2>AI Command Center</h2><span class="muted14" data-part="linkstate"></span></div>
    <div class="set-row"><div class="l"><span>Let the Command Center connect</span><span>Her team lead can talk to her and hand her tasks. Her rules still apply.</span></div><input type="checkbox" data-set="allowCommandCenter" style="width:22px;height:22px;accent-color:var(--sage)"></div>
    <div class="set-row"><div class="l"><span>Allow connections from my other devices</span><span>Off means only this PC can reach her</span></div><input type="checkbox" data-set="allowLanConnections" style="width:22px;height:22px;accent-color:var(--sage)"></div>
    <div class="set-row"><div class="l"><span>Connection key</span><span data-part="linkfile"></span></div><div class="btns"><button type="button" class="btn sm" data-act="linkfile">Show key file</button><button type="button" class="btn sm warn" data-act="linkkey">Make a new key</button></div></div>
  </section>
</main>`
};

/* ---------------- parts ---------------- */
const parts = {
  mind: {
    orb: (s) => { const o = orbStyle(s, 72); return '<div aria-hidden="true" class="' + o.cls + ' breathing" style="' + o.style + '"></div>'; },
    name: (s) => esc(s.name),
    chips: (s) => '<span class="chip live">' + esc(s.statusChip) + '</span><span class="chip">' + esc(s.aliveLabel) + '</span><span class="chip">' + esc(s.autonomy) + '</span>',
    talkbtn: (s) => 'Talk to ' + esc(s.name),
    pausebtn: (s) => (s.status === 'paused' ? 'Resume mind' : 'Pause mind'),
    brainwarn: (s) => {
      if (s.pulling) return '<div class="banner">Downloading her brain: ' + esc(s.pulling.model) + ' · ' + esc(s.pulling.status) + (s.pulling.pct != null ? ' ' + s.pulling.pct + '%' : '') + '</div>';
      if (s.modelsMissing && s.modelsMissing.length) return '<div class="banner rowc" style="gap:12px"><span>Her brain isn’t downloaded yet (' + esc(s.modelsMissing.join(', ')) + '). It’s about 5 GB.</span><button type="button" class="btn sm primary" data-act="pullbrain">Download her brain</button></div>';
      if (!s.brain.ok) return '<div class="banner">Her brain isn’t reachable. Make sure Ollama is running at ' + esc(s.settings.ollamaUrl) + '.</div>';
      return '';
    },
    thought: (s) => '“' + esc(s.current.thought) + '”',
    moodline: (s) => 'Mood: ' + esc(s.current.mood || '—') + (s.current.wants ? ' · Wants to: ' + esc(s.current.wants) : ''),
    drives: (s) => s.drives.map((d) => meter(d)).join(''),
    monologue: (s) => s.monologue.length ? s.monologue.map((t) => '<div class="thought-row"><span>' + esc(t.time) + '</span><span>' + esc(t.text) + '</span></div>').join('') : '<div class="empty">Quiet so far.</div>',
    tasks: (s) => s.tasks.length ? s.tasks.map((k) => '<div class="task"><div class="t">' + esc(k.title) + '</div><div class="m">' + esc(k.meta) + '</div><span class="badge" style="background:' + k.badgeBg + ';color:' + k.badgeFg + '">' + esc(k.badge) + '</span></div>').join('') : '<div class="empty">Nothing yet. She starts things on her own when she wants to.</div>',
    selfdesc: (s) => '“' + esc(s.self.description) + '”',
    selfwhen: (s) => esc(s.self.rewritten),
    recentmem: (s) => s.recentMemories.map((m) => '<div class="mem-row"><span class="tag">' + esc(m.kind) + '</span><span>' + esc(m.text) + '</span></div>').join('') || '<div class="empty">No memories yet.</div>'
  },
  talk: {
    orb: (s) => { const o = orbStyle(s, 44); return '<div aria-hidden="true" class="' + o.cls + ' breathing" style="' + o.style + ';box-shadow:0 0 20px #9cc9a555"></div>'; },
    name: (s) => esc(s.name),
    mood: (s) => '● ' + (s.status === 'awake' ? 'Awake' : esc(s.status[0].toUpperCase() + s.status.slice(1))) + ' · mood: ' + esc(s.talk.mood || '—'),
    msgs: (s) => {
      let out = '', lastDay = '', lastAt = 0;
      for (const m of s.talk.chat) {
        const d = new Date(m.at);
        const day = d.toDateString();
        if (day !== lastDay || m.at - lastAt > 3 * 3600000) {
          const h = d.getHours();
          const part = h >= 21 || h < 5 ? 'Tonight' : h < 12 ? 'This morning' : h < 17 ? 'This afternoon' : 'This evening';
          const label = day === new Date().toDateString() ? part : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          out += '<div class="daysep">' + esc(label) + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, '') + '</div>';
          lastDay = day;
        }
        lastAt = m.at;
        if (m.role === 'you') out += m.from ? '<div class="me" style="background:#2a2f3a"><div style="font-size:12px;color:var(--muted);margin-bottom:4px">From ' + esc(m.from) + ' \u00b7 AI Command Center</div>' + esc(m.text) + '</div>' : '<div class="me">' + esc(m.text) + '</div>';
        else out += '<div class="her">' + (m.thinking ? '<details><summary>What she was thinking before she answered</summary><p>' + esc(m.thinking) + '</p></details>' : '') +
          '<div class="bubble">' + esc(m.text) + '</div><button type="button" class="btn sm speak" data-act="speak" data-id="' + esc(m.id) + '" aria-label="Hear her say this">' + ICON_PLAY + '</button></div>';
      }
      if (ui.waitingReply) out += '<div class="her"><div class="bubble" style="color:var(--muted)">…</div></div>';
      return out || '<div class="empty" style="align-self:center">Say hi. She’s been waiting.</div>';
    },
    drives: (s) => s.talk.drives.map((d) => meter(d, 's8')).join(''),
    using: (s) => s.talk.using.length ? s.talk.using.map((t) => '<div class="mini">' + esc(t) + '</div>').join('') : '<div class="empty">None yet.</div>',
    saving: (s) => s.talk.saving.length ? s.talk.saving.map((t) => '<div class="mini amber">' + esc(t) + '</div>').join('') : '<div class="empty">Nothing yet.</div>'
  },
  avatar: {
    redrawbtn: (s) => (s.avatar.drawing ? 'Drawing… ' + (s.drawProgress ? (s.drawProgress.i + 1) + '/' + s.drawProgress.n : '') : 'Redraw her'),
    comfywarn: (s) => (s.avatar.comfyOk ? '' : '<div class="banner">ComfyUI isn’t reachable at ' + esc(s.settings.comfyUrl) + '. Start it to draw her.</div>'),
    livechip: (s) => '● Live · ' + esc(s.current.mood || s.avatar.expression.toLowerCase()),
    portrait: (s) => {
      const av = s.avatar;
      if (av.settings.style === 'Moon orb') return '<span class="moon" aria-hidden="true"></span><div class="orb big-orb breathing" aria-hidden="true"></div><span class="cap">Moon orb</span>';
      if (av.portrait) return '<img id="portrait-img" class="breathing" alt="" src="' + esc(av.portrait) + '">' + (av.blink ? '<img id="blink-img" alt="" src="' + esc(av.blink) + '" style="opacity:0">' : '') + (av.talking ? '<img id="talk-img" alt="" src="' + esc(av.talking) + '" style="opacity:0">' : '');
      return '<span class="moon" aria-hidden="true"></span><div class="ghost" aria-hidden="true"></div><span class="cap">Not drawn yet · press Redraw her</span>';
    },
    faces: (s) => s.avatar.faces.map((f) => '<div class="face' + (f.on ? ' on' : '') + '"><div class="c" role="img" aria-label="' + esc(f.label) + ' expression"' + (f.img ? " style=\"background-image:url('" + esc(f.img) + "');" + faceCrop(s) + "\"" : '') + '></div><span style="color:' + (f.on ? 'var(--text)' : 'var(--muted)') + '">' + esc(f.label) + '</span></div>').join(''),
    framing: (s) => [['full', 'Full body'], ['portrait', 'Head & shoulders']].map(([k, l]) => '<button type="button" class="pill" aria-pressed="' + ((s.avatar.settings.framing || 'full') === k) + '" data-act="framing" data-v="' + k + '">' + l + '</button>').join(''),
    styles: (s) => ['Anime', 'Semi-real', '3D', 'Moon orb'].map((x) => '<button type="button" class="pill" aria-pressed="' + (s.avatar.settings.style === x) + '" data-act="style" data-v="' + x + '">' + x + '</button>').join(''),
    roster: (s) => {
      const bg = { Moonlit: 'linear-gradient(180deg,#3a4660,#1a2233)', Scholar: 'linear-gradient(180deg,#4a3e2e,#221c15)', Ranger: 'linear-gradient(180deg,#2e4a36,#15221a)', Tinkerer: 'linear-gradient(180deg,#4a2e3e,#22151c)' };
      return Object.keys(s.roster).map((n) => '<button type="button" aria-label="Pick ' + n + '" aria-pressed="' + (s.avatar.settings.roster === n) + '" data-act="roster" data-v="' + n + '"><span class="pic" aria-hidden="true" style="background:' + bg[n] + '"></span>' + n + '</button>').join('');
    },
    creator: (s) => {
      const av = s.avatar.settings;
      const sw = { hair: guessColor(av.hair), eyes: guessColor(av.eyes), outfit: guessColor(av.outfit), nightOutfit: guessColor(av.nightOutfit === 'Same as day' ? av.outfit : av.nightOutfit), accent: av.accent === 'Hearth sage' ? '#9cc9a5' : guessColor(av.accent) };
      return [['hair', 'Hair'], ['eyes', 'Eyes'], ['outfit', 'Outfit'], ['nightOutfit', 'Late-night outfit'], ['accent', 'Accent color']].map(([k, l]) =>
        '<div class="creator-row"><label for="cr-' + k + '">' + l + '</label><span style="display:flex;align-items:center;gap:8px"><span class="swatch" style="background:' + sw[k] + '" aria-hidden="true"></span><input id="cr-' + k + '" data-avfield="' + k + '" value="' + esc(av[k]) + '"></span></div>').join('');
    },
    opinion: (s) => {
      const a = s.avatar;
      if (a.suggestion) return '<p class="p">“' + esc(a.suggestion.text) + '”</p><div class="btns"><button type="button" class="btn sm primary" data-act="look-yes">Try her idea</button><button type="button" class="btn sm" data-act="look-no">Keep it as is</button></div>';
      return '<p class="p">' + (a.opinion ? '“' + esc(a.opinion) + '”' : 'She hasn’t said anything about her look yet. She thinks about it while she sleeps.') + '</p>';
    },
    voices: (s) => Object.keys(s.ttsVoices).map((k) => { const v = s.ttsVoices[k], on = s.avatar.settings.voice === k;
      return '<div class="voice-opt' + (on ? ' on' : '') + '" data-act="pickvoice" data-v="' + k + '"><button type="button" class="play" aria-label="Play ' + esc(v.name) + ' sample" data-act="sample" data-v="' + k + '">' + ICON_PLAY + '</button><div style="display:flex;flex-direction:column;gap:2px;min-width:0"><span style="font-size:15px;font-weight:600">' + esc(v.name) + '</span><span class="muted">' + esc(v.what) + '</span></div><span style="margin-left:auto;font-size:13px;color:var(--sage-l)">' + (on ? 'Picked' : '') + '</span></div>'; }).join(''),
    places: (s) => { const cc = s.link && s.link.connected;
      return [['talk', 'Talk screen', 'Next to your chat with her'], ['buddy', 'Desktop buddy', 'Small floating ' + s.name + ' on your Hearth OS desktop'], ['mind', 'Mind screen', 'Replaces the orb at the top'], ['commandCenter', 'AI Command Center', cc ? 'Connected \u00b7 her face shows on your team' : 'When you connect it later']].map(([k, n, w]) =>
      '<label class="tog"><span class="t"><span class="n">' + esc(n) + '</span><span class="w">' + esc(w) + '</span></span><input type="checkbox" data-place="' + k + '"' + (s.avatar.settings.places[k] || (k === 'commandCenter' && cc) ? ' checked' : '') + (k === 'commandCenter' && !cc ? ' disabled' : '') + '></label>').join(''); }
  },
  attention: {
    spot: (s) => {
      const sp = s.attention.spotlight;
      return '<div style="display:flex;flex-direction:column;gap:10px;align-items:center;max-width:640px"><div class="lbl">In the spotlight · ' + (sp ? fmtSecs(sp.secs) : '—') + '</div><div class="big">' + esc(sp ? sp.label : 'Nothing yet') + '</div><div class="muted14">' + (sp && sp.reason ? 'Got here because: ' + esc(sp.reason) : '') + '</div></div>' +
        '<div class="btns" style="gap:12px;justify-content:center">' + (s.attention.waiting.map((w) => '<div class="waiting"><span>' + esc(w.label) + '</span><span class="p" style="color:' + w.color + '">push ' + esc(w.push) + '</span></div>').join('') || '<span class="muted14">Nothing waiting.</span>') + '</div>' +
        '<div class="muted">Waiting at the edge. The strongest push takes the spotlight next.</div>';
    },
    background: (s) => s.attention.background.map((b) => '<div class="list-row" style="justify-content:space-between"><span>' + esc(b.label) + '</span><span style="color:var(--muted)">' + esc(b.state) + '</span></div>').join(''),
    split: (s) => '<div class="splitbar">' + s.attention.split.map((x) => '<div title="' + esc(x.label) + '" style="width:' + x.w + ';background:' + x.color + '"></div>').join('') + '</div>' +
      s.attention.split.map((x) => '<div class="legend"><span class="sq" style="background:' + x.color + '" aria-hidden="true"></span><span>' + esc(x.label) + '</span><span>' + x.w + '</span></div>').join('') +
      '<div class="muted">' + esc(s.attention.note) + '</div>'
  },
  voices: {
    debate: (s) => {
      const d = s.voices.debate;
      if (!d) return '<div class="label">Arguing right now</div><div class="empty">Nothing to argue about right now. The voices speak up when she has a real decision to make.</div>';
      return '<div class="rowc" style="gap:12px"><div style="display:flex;flex-direction:column;gap:4px"><div class="label">' + (d.undecided ? 'Arguing right now' : 'Last argument') + '</div><h2 style="font-size:24px">' + esc(d.q) + '</h2></div><span class="chip ' + (d.undecided ? 'amber' : 'live') + '">' + esc(d.statusLabel) + '</span></div>' +
        '<div class="grid g240" style="gap:16px">' + d.voices.map((v) => '<div class="vcard" style="border-top-color:' + v.color + '"><div class="top"><span>' + esc(v.name) + '</span><span>pull ' + v.pull + '%</span></div><p>' + (v.says ? '“' + esc(v.says) + '”' : '…') + '</p><div class="bar s6"><div style="width:' + v.w + ';background:' + v.color + ';border-radius:0"></div></div></div>').join('') + '</div>' +
        '<div class="note-green"><strong style="color:var(--sage-l)">' + (d.undecided ? 'Leaning toward:' : 'Decided:') + '</strong> ' + esc(d.leaning) + '</div>';
    },
    who: (s) => s.voices.who.map((v) => '<div class="who"><span class="dot" style="background:' + v.color + '" aria-hidden="true"></span><div style="display:flex;flex-direction:column;gap:2px"><span style="font-size:15px;font-weight:600">' + esc(v.name) + '</span><span class="muted14" style="line-height:1.5">' + esc(v.wants) + '</span></div><span class="w">wins ' + v.wins + '</span></div>').join(''),
    past: (s) => s.voices.past.length ? s.voices.past.map((p) => '<div class="box"><div class="t">' + esc(p.q) + '</div><div class="b">' + esc(p.result) + '</div><div class="m">' + esc(p.after) + '</div></div>').join('') : '<div class="empty">No arguments yet.</div>'
  },
  body: {
    orb: (s) => '<div aria-hidden="true" class="orb ' + (s.body.orb === 'green' ? '' : s.body.orb) + ' breathing" style="width:120px;height:120px;' + (s.body.orb === 'green' ? 'box-shadow:0 0 0 8px #1e2a22,0 0 40px #9cc9a555' : '') + '"></div>',
    feeling: (s) => '“' + esc(s.body.feeling) + '”',
    organs: (s) => s.body.organs.length ? s.body.organs.map((o) => '<div class="organ"><div class="top"><span>' + esc(o.part) + '</span><span>' + esc(o.raw) + '</span></div><div class="feel" style="color:' + o.color + '">' + esc(o.feel) + '</div><div class="bar s8"><div style="width:' + o.w + ';background:' + o.color + '"></div></div><div class="muted">' + esc(o.means) + '</div></div>').join('') : '<div class="empty">Her hardware sense is off or hasn’t read the PC yet.</div>',
    senses: (s) => s.body.senses.map((x) => '<div class="sense"><div style="display:flex;flex-direction:column;gap:2px;min-width:0"><span style="font-size:15px;font-weight:600">' + esc(x.name) + '</span><span class="muted">' + esc(x.what) + '</span></div><label><input type="checkbox" data-sense="' + x.key + '"' + (x.on ? ' checked' : '') + ' style="width:20px;height:20px;accent-color:var(--sage)">' + x.state + '</label></div>').join(''),
    events: (s) => s.body.events.length ? s.body.events.map((e) => '<div class="list-row"><span class="when">' + esc(e.when) + '</span><span>' + esc(e.text) + '</span></div>').join('') : '<div class="empty">No body memories yet.</div>'
  },
  dreams: {
    last: (s) => {
      const d = s.dreams.last;
      if (!d) return '<div class="dream-pic" role="img" aria-label="No dream yet"><span>No dreams yet</span></div><div class="dream-body"><div class="label">Tonight</div><h2>She hasn’t dreamed yet</h2><p class="p">Her first dream comes during her first sleep, at ' + esc(s.settings.sleepTime) + '.</p></div>';
      return '<div class="dream-pic" role="img" aria-label="Picture of the dream: ' + esc(d.title) + '"' + (d.image ? " style=\"background-image:url('" + esc(d.image) + "')\"" : '') + '>' + (d.image ? '' : '<span>' + (s.dreams.comfyOk ? 'Picture not drawn' : 'ComfyUI wasn’t running') + '</span>') + '</div>' +
        '<div class="dream-body"><div class="label">' + esc(d.time) + ' · ' + esc(d.mood) + '</div><h2>' + esc(d.title) + '</h2><p class="p" style="line-height:1.65">“' + esc(d.text) + '”</p>' +
        '<div style="display:flex;flex-direction:column;gap:8px"><div class="muted14" style="color:var(--muted2)">Made from these memories</div><div class="btns" style="gap:8px">' + d.sources.map((x) => '<span class="tagpill">' + esc(x) + '</span>').join('') + '</div></div>' +
        (d.takeaway ? '<div class="note-amber"><strong>What she took from the dream:</strong> ' + esc(d.takeaway) + '</div>' : '') + '</div>';
    },
    journal: (s) => s.dreams.journal.length ? s.dreams.journal.map((d) => '<div class="jcard"><div class="pic" role="img" aria-label="Dream picture: ' + esc(d.title) + '"' + (d.image ? " style=\"background-image:url('" + esc(d.image) + "')\"" : '') + '></div><div class="tx"><div class="t">' + esc(d.title) + '</div><div class="m">' + esc(d.meta) + '</div></div></div>').join('') : '<div class="empty">Older dreams show up here.</div>',
    themes: (s) => s.dreams.themes.length ? s.dreams.themes.map((t) => '<div class="meter"><div class="top"><span>' + esc(t.label) + '</span><span>' + t.count + ' dreams</span></div><div class="bar s8"><div style="width:' + t.w + ';background:#b8a6e3"></div></div></div>').join('') : '<div class="empty">No recurring themes yet.</div>'
  },
  free: {
    minutes: (s) => fmtMins(s.free.minutes) + ' a day · when the PC is quiet',
    current: (s) => s.free.current ? '<div class="note-green" style="display:flex;flex-direction:column;gap:6px"><div style="font-size:13px;color:var(--sage-l)">Doing now</div><div style="font-size:16px;font-weight:600">' + esc(s.free.current.activity) + '</div><div class="muted">' + esc(s.free.current.meta) + '</div></div>' : '<div class="box"><div class="m">Not on free time right now</div></div>',
    hobbies: (s) => s.free.hobbies.length ? s.free.hobbies.map((h) => '<span class="tagpill" style="font-size:14px;padding:8px 12px">' + esc(h) + '</span>').join('') : '<span class="empty">She picks up hobbies as she uses her free time.</span>',
    made: (s) => s.free.made.length ? s.free.made.map((m) => '<div class="list-row" style="justify-content:space-between"><span>' + esc(m.title) + '</span><span style="color:var(--muted)">' + esc(m.when) + '</span></div>').join('') : '<div class="empty">Nothing made yet.</div>',
    wishes: (s) => s.free.wishes.length ? s.free.wishes.map((w) => '<div class="wish"><div class="tx">“' + esc(w.text) + '”</div><div class="btns" style="gap:8px"><button type="button" class="btn sm primary" data-act="wish-yes" data-id="' + w.id + '">Yes</button><button type="button" class="btn sm" data-act="wish-later" data-id="' + w.id + '"' + (w.later ? ' disabled' : '') + '>Not now</button><button type="button" class="btn sm" data-act="wish-talk" data-id="' + w.id + '">Talk about it</button><span style="margin-left:auto" class="muted">' + esc(w.when) + '</span></div></div>').join('') : '<div class="empty">She hasn’t asked for anything yet.</div>',
    checkin: (s) => s.free.checkin ? '“' + esc(s.free.checkin) + '”' : '<span class="empty">Her first check-in comes after her first week.</span>',
    pushbacks: (s) => s.free.pushbacks.length ? s.free.pushbacks.map((p) => '<div style="display:flex;flex-direction:column;gap:4px;padding:10px 0;border-top:1px solid var(--line2)"><span style="font-size:14px;font-weight:600">' + esc(p.ask) + '</span><span style="font-size:14px;color:var(--text2);line-height:1.5">' + esc(p.why) + '</span></div>').join('') : '<div class="empty">She hasn’t needed to push back yet.</div>'
  },
  memories: {
    count: (s) => s.memories.total.toLocaleString('en-US') + (s.memories.total === 1 ? ' memory · ' : ' memories · ') + s.memories.lessonsCount + (s.memories.lessonsCount === 1 ? ' lesson' : ' lessons') + ' · stored only on your Nvidia PC',
    sleep: (s) => {
      const l = s.memories.lastSleep;
      if (!l) return '<div style="flex:1 1 320px;display:flex;flex-direction:column;gap:10px"><div class="label">Last night’s sleep</div><p class="quote m">She hasn’t slept yet. Bedtime is ' + esc(s.settings.sleepTime) + '.</p></div>';
      return '<div style="flex:1 1 320px;display:flex;flex-direction:column;gap:10px"><div class="label">Last night’s sleep · ' + esc(l.range) + '</div><p class="quote m">“' + esc(l.summary) + '”</p></div>' +
        '<div style="flex:1 1 320px" class="two"><div class="stat"><div class="n">' + l.reviewed + '</div><div class="l">moments reviewed</div></div><div class="stat"><div class="n">' + l.kept + '</div><div class="l">kept as memories</div></div><div class="stat"><div class="n a">' + l.lessons + '</div><div class="l">new lessons</div></div><div class="stat"><div class="n a">' + l.selfChanges + '</div><div class="l">self-model change' + (l.selfChanges === 1 ? '' : 's') + '</div></div></div>';
    },
    filters: () => [['all', 'All'], ['event', 'Events'], ['lesson', 'Lessons'], ['feeling', 'Feelings'], ['about_you', 'About you']].map(([k, l]) => '<button type="button" class="pill" aria-pressed="' + (ui.memFilter === k) + '" data-act="memfilter" data-v="' + k + '">' + l + '</button>').join(''),
    timeline: () => {
      const list = ui.memList || [];
      const kinds = { event: 'Event', lesson: 'Lesson', feeling: 'Feeling', about_you: 'About you', fact: 'Fact', core: 'Core' };
      return list.length ? list.slice(0, 80).map((e) => '<div style="display:flex;gap:16px;padding:12px 0;border-top:1px solid var(--line2)"><div style="flex:0 0 84px;font-size:13px;color:var(--muted);line-height:1.5">' + esc(whenLabel(e.at)) + '</div><div style="display:flex;flex-direction:column;gap:6px;min-width:0;flex:1"><div style="font-size:15px;line-height:1.5">' + esc(e.text) + '</div><div class="btns" style="gap:8px;font-size:12px"><span class="tag">' + esc(kinds[e.kind] || e.kind) + '</span><span style="color:var(--muted)">importance ' + esc(e.weight) + '</span>' + (ui.forgetMode ? '<button type="button" class="btn sm warn" style="min-height:32px" data-act="forget" data-id="' + e.id + '">Forget</button>' : '') + '</div></div></div>').join('') : '<div class="empty">' + (ui.memQuery ? 'Nothing matches.' : 'No memories yet.') + '</div>';
    },
    lessons: (s) => s.memories.lessons.length ? s.memories.lessons.map((l) => '<div class="box"><div style="font-size:15px;line-height:1.5">' + esc(l.text) + '</div><div class="m">' + esc(l.from) + '</div></div>').join('') : '<div class="empty">Lessons come from sleep.</div>',
    about: (s) => {
      if (ui.editingAbout) return s.memories.about.map((m) => '<div style="display:flex;gap:8px;margin-bottom:8px"><input class="input dark" style="flex:1" data-aboutid="' + m.id + '" value="' + esc(m.text) + '"><button type="button" class="btn sm warn" data-act="forget" data-id="' + m.id + '">Forget</button></div>').join('') + '<button type="button" class="btn sm primary" data-act="saveabout">Save</button>';
      return '<p class="p">' + (s.memories.about.length ? s.memories.about.map((m) => esc(m.text.replace(/\.?$/, '.'))).join(' ') : 'She doesn’t know much about you yet. Talk to her.') + '</p>';
    },
    editbtn: () => (ui.editingAbout ? 'Done' : 'Edit')
  },
  selfcheck: {
    tests: (s) => s.selfCheck.tests.map((t) => '<div class="card" style="padding:20px;gap:10px"><div class="muted14" style="color:var(--muted2)">' + esc(t.name) + '</div><div style="font-family:var(--head);font-size:30px;color:' + t.color + '">' + esc(t.score) + '</div><div style="font-size:14px;line-height:1.5;color:var(--text2)">' + esc(t.what) + '</div><div class="muted">' + esc(t.trend) + '</div></div>').join(''),
    continuity: (s) => { const c = s.selfCheck.continuity;
      return '<div class="two"><div class="stat"><div class="n s24">' + esc(c.days) + '</div><div class="l">alive</div></div><div class="stat"><div class="n s24">' + esc(c.gaps) + '</div><div class="l">times she was switched off</div></div><div class="stat"><div class="n s24">' + esc(c.sameValues) + '</div><div class="l">same values as day 1</div></div><div class="stat"><div class="n s24 a">' + esc(c.lastBackup) + '</div><div class="l">latest backup of her mind</div></div></div><p class="p" style="font-size:14px;line-height:1.55">“' + esc(c.quote) + '”</p>'; },
    unknowns: (s) => s.selfCheck.unknowns.length ? s.selfCheck.unknowns.map((u) => '<div class="box"><div class="t">' + esc(u.q) + '</div><div class="b">' + esc(u.now) + '</div></div>').join('') : '<div class="empty">None yet.</div>',
    surprises: (s) => s.selfCheck.surprises.length ? s.selfCheck.surprises.map((x) => '<div class="list-row"><span class="when">' + esc(x.when) + '</span><span>' + esc(x.text) + '</span></div>').join('') : '<div class="empty">She hasn’t surprised herself yet.</div>'
  },
  self: {
    traits: (s) => s.selfRules.traits.map((t) => '<div class="meter"><div class="top"><span>' + esc(t.label) + '</span><span>' + t.start + ' → ' + t.now + '</span></div><div class="trait-bar"><div class="now" style="width:' + t.nowW + '"></div><div class="start" aria-hidden="true" style="left:' + t.startW + '"></div></div></div>').join(''),
    desc: (s) => '“' + esc(s.self.description) + '”',
    facts: (s) => [['Thinks she’s good at', s.self.good_at], ['Thinks she’s bad at', s.self.bad_at], ['Current goal', s.self.goal], ['Open question she keeps', s.self.open_question]].map(([l, v]) => '<div class="stat" style="display:flex;flex-direction:column;gap:6px"><div class="l">' + l + '</div><div style="font-size:14px;line-height:1.5">' + esc(v) + '</div></div>').join(''),
    changes: (s) => s.selfRules.changes.length ? s.selfRules.changes.map((c) => '<div class="list-row"><span class="when" style="flex:0 0 72px">' + esc(c.when) + '</span><span>' + esc(c.text) + '</span></div>').join('') : '<div class="empty">No changes yet. She rewrites herself during sleep.</div>',
    rules: (s) => '<div class="can"><div style="font-weight:600;color:var(--sage-l)">Can do on her own</div>' + s.selfRules.can.map((r) => '<div style="font-size:14px;line-height:1.5">✓ ' + esc(r) + '</div>').join('') + '</div>' +
      '<div class="never"><div style="font-weight:600;color:var(--red-l)">Never, no matter what</div>' + s.selfRules.never.map((r) => '<div style="font-size:14px;line-height:1.5">✕ ' + esc(r) + '</div>').join('') + '</div>',
    folders: (s) => s.selfRules.folders.map((f, i) => '<span class="folder">' + esc(f.replace(/^\/home\/[^/]+/, '~')) + (i === 0 ? '' : '<button type="button" aria-label="Remove folder" data-act="rmfolder" data-v="' + esc(f) + '">✕</button>') + '</span>').join('') + '<button type="button" class="btn sm dash" data-act="addfolder">Add folder</button>'
  },
  settings: {
    gen: (s) => esc(s.brain.generation),
    linkstate: (s) => (!s.link ? '' : !s.link.enabled ? 'Off' : s.link.connected ? 'Connected \u00b7 ' + esc(s.link.client || '') : 'Waiting for it on port ' + s.link.port),
    linkfile: (s) => (s.link ? esc(s.link.keyFile.replace(/^\/home\/[^/]+/, '~')) + ' \u00b7 the Command Center reads it from there' : ''),
    lineagenote: (s) => (s.growth ? esc(s.growth.nextNote) : ''),
    growstatus: (s) => {
      const g = s.growth; if (!g) return '';
      if (!g.supported) return '<div class="banner">Growing works with her starting brain models. Set her brain model back to huihui_ai/qwen3-abliterated:8b-v2 to grow.</div>';
      const st = g.status;
      if (!st) return '<div class="muted14">' + (g.setupReady ? g.newExamples.toLocaleString('en-US') + ' new moments of her life saved since her last generation.' : 'Setup installs a Python training kit and her base weights, about 25 GB on disk, once.') + '</div>';
      const pct = st.pct == null ? '' : st.pct + '%';
      const color = st.stage === 'error' ? 'var(--red-l)' : 'var(--sage-l)';
      return '<div class="box"><div class="rowc"><span class="t" style="color:' + color + '">' + esc({ setup: 'Setting up', download: 'Downloading', prepare: 'Reading her life', load: 'Loading', train: 'Training', convert: 'Converting', test: 'Testing', done: 'Finished', ready: 'Ready', error: 'Problem', stopped: 'Stopped' }[st.stage] || st.stage) + '</span><span class="m">' + pct + '</span></div>' +
        (st.pct != null ? '<div class="bar s8"><div style="width:' + st.pct + '%;background:var(--sage)"></div></div>' : '') + '<div class="m">' + esc(st.msg) + '</div></div>';
    },
    growbtns: (s) => {
      const g = s.growth; if (!g || !g.supported) return '';
      if (g.running) return '<button type="button" class="btn sm warn" data-act="growstop">Stop</button>';
      return (g.setupReady ? '<button type="button" class="btn sm primary" data-act="grownow">Grow now</button><button type="button" class="btn sm" data-act="growsetup">Repair setup</button>' : '<button type="button" class="btn sm primary" data-act="growsetup">Set up growing</button>');
    },
    generations: (s) => {
      const g = s.growth; if (!g) return '';
      const col = { active: 'var(--sage-l)', kept: 'var(--muted2)', rejected: 'var(--red-l)' };
      return '<div style="display:flex;flex-direction:column;gap:0">' + g.generations.map((x) => '<div class="set-row"><div class="l"><span>Generation ' + x.gen + ' <span style="color:' + col[x.status] + ';font-size:13px">\u00b7 ' + esc(x.status === 'active' ? 'thinking with this one' : x.status) + '</span></span><span>' + esc(x.model) + ' \u00b7 born ' + esc(x.born) + (x.gen ? ' \u00b7 trained on ' + (x.examples || 0).toLocaleString('en-US') + ' moments' : '') + ' \u00b7 test score ' + esc(x.score) + (x.note ? ' \u00b7 ' + esc(x.note) : '') + '</span></div>' +
        (x.status === 'kept' ? '<button type="button" class="btn sm" data-act="usegen" data-v="' + x.gen + '">Switch her to this one</button>' : '') + '</div>').join('') + '</div>';
    },
    version: (s) => 'Hearth AI ' + esc(s.version),
    updstate: (s) => { const u = s.update; if (!u) return ''; return u.state === 'available' ? 'Update ' + esc(u.version) + ' is available' : u.state === 'downloading' ? 'Downloading ' + u.percent + '%' : u.state === 'ready' ? 'Update ' + esc(u.version) + ' is ready' : u.state === 'none' ? 'You’re up to date' : u.state === 'checking' ? 'Checking…' : u.state === 'error' ? 'Couldn’t check: ' + esc(u.message) : ''; }
  }
};

/* ---------------- helpers ---------------- */
function fmtSecs(n) { return n < 90 ? n + ' seconds' : Math.round(n / 60) + ' min'; }
function fmtMins(m) { return m % 60 === 0 ? (m / 60) + (m === 60 ? ' hour' : ' hours') : m + ' minutes'; }
function whenLabel(t) {
  const d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, '');
  const y = new Date(now - 86400000);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function guessColor(text) {
  const t = String(text || '').toLowerCase();
  const map = [['silver', '#cfd6e6'], ['white', '#eeeeee'], ['black', '#1a1a1a'], ['pale blue', '#9fc3e6'], ['blue', '#5b8ed6'], ['red', '#c0504d'], ['pink', '#e39bc0'], ['violet', '#a38bd6'], ['purple', '#8a63c9'], ['green', '#5f9e6e'], ['sage', '#9cc9a5'], ['amber', '#e0b26b'], ['gold', '#d9b44a'], ['blonde', '#e8d48a'], ['chestnut', '#7a4a2a'], ['brown', '#6b4a2a'], ['grey', '#8a8f93'], ['gray', '#8a8f93'], ['orange', '#e08a4a'], ['dark', '#2a3550'], ['hoodie', '#3a4660']];
  for (const [k, c] of map) if (t.includes(k)) return c;
  return '#3a4660';
}

/* ---------------- rendering ---------------- */
function render() {
  const s = ui.snap;
  if (!s) return;
  const content = $('#content');
  if (ui.built !== ui.screen) {
    content.innerHTML = shells[ui.screen](s);
    ui.built = ui.screen;
    afterBuild(s);
  }
  const ps = parts[ui.screen] || {};
  for (const el of content.querySelectorAll('[data-part]')) {
    const fn = ps[el.getAttribute('data-part')];
    if (!fn) continue;
    if (el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') continue;
    const html = fn(s);
    if (el._html !== html) {
      const msgs = el.getAttribute('data-part') === 'msgs';
      const atBottom = msgs && el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      el.innerHTML = html;
      el._html = html;
      if (msgs && (atBottom || !el._scrolled)) { el.scrollTop = el.scrollHeight; el._scrolled = true; }
    }
  }
  for (const a of document.querySelectorAll('.side a')) {
    if (a.getAttribute('data-nav') === ui.screen) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  const cc = $('[data-part="ccbox"]');
  if (cc) { cc.textContent = 'AI Command Center: ' + s.commandCenter; cc.style.borderStyle = s.commandCenter === 'connected' ? 'solid' : 'dashed'; cc.style.color = s.commandCenter === 'connected' ? 'var(--sage-l)' : ''; }
  const bl = $('[data-part="brainline"]');
  if (bl) bl.textContent = 'Brain: ' + s.brain.model + ' (gen ' + s.brain.generation + ') on your Nvidia PC (RTX 5070) · Ollama · offline' + (s.brain.ok ? '' : ' · not reachable');
  avatarLife(s);
  const ib = $('[data-act="installupdate"]');
  if (ib) ib.hidden = !(s.update && s.update.state === 'ready');
}

function afterBuild(s) {
  if (ui.screen === 'self') {
    $('#ai-name').value = s.name;
    $('#ai-personality').value = s.selfRules.personality;
  }
  if (ui.screen === 'avatar') $('#let-suggest').checked = !!s.avatar.settings.letHerSuggest;
  if (ui.screen === 'settings') {
    for (const el of document.querySelectorAll('[data-set]')) {
      const v = getPath(s.settings, el.getAttribute('data-set'));
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v == null ? '' : v;
    }
    H.listModels().then((m) => { $('#model-list').innerHTML = m.map((x) => '<option value="' + esc(x) + '">').join(''); });
    H.listCheckpoints().then((m) => { $('#ckpt-list').innerHTML = m.map((x) => '<option value="' + esc(x) + '">').join(''); });
    if (ui.anchor) { const el = document.getElementById(ui.anchor); if (el) el.scrollIntoView(); ui.anchor = null; }
  }
  if (ui.screen === 'memories') loadMemories();
  if (ui.screen === 'talk') {
    const ta = $('#talk-input');
    if (ui.prefill) { ta.value = ui.prefill; ui.prefill = null; }
    ta.focus();
  }
}
function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
function setPath(p, v) { const out = {}; let cur = out; const ks = p.split('.'); ks.slice(0, -1).forEach((k) => { cur[k] = {}; cur = cur[k]; }); cur[ks[ks.length - 1]] = v; return out; }

async function loadMemories() {
  const kind = ui.memFilter === 'all' ? null : ui.memFilter;
  ui.memList = await H.searchMemories(ui.memQuery, kind);
  if (!ui.memQuery) ui.memList.sort((a, b) => b.at - a.at);
  const el = $('[data-part="timeline"]');
  if (el) { el._html = null; }
  render();
}

/* Avatar life: blinking, and mouth moving with her voice */
let blinkTimer = null;
function avatarLife() {
  if (blinkTimer) return;
  blinkTimer = setInterval(() => {
    const b = document.getElementById('blink-img');
    if (!b || ui.speaking) return;
    b.style.opacity = '1';
    setTimeout(() => { b.style.opacity = '0'; }, 140);
  }, 4200);
}

async function speakText(text) {
  const s = ui.snap;
  const r = await H.speak(text, s.avatar.settings.voice);
  if (!r.ok) { toast('Her voice isn’t ready: ' + r.reason); return; }
  const audio = $('#voice-audio');
  audio.src = 'data:audio/wav;base64,' + r.wav;
  audio.volume = r.volume;
  ui.speaking = true;
  const ctx = new AudioContext();
  const src = ctx.createMediaElementSource(audio);
  const an = ctx.createAnalyser(); an.fftSize = 512;
  src.connect(an); an.connect(ctx.destination);
  const buf = new Uint8Array(an.fftSize);
  const tick = () => {
    if (!ui.speaking) return;
    an.getByteTimeDomainData(buf);
    let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    const t = document.getElementById('talk-img');
    if (t) t.style.opacity = peak > 12 ? '1' : '0';
    requestAnimationFrame(tick);
  };
  audio.onended = () => { ui.speaking = false; const t = document.getElementById('talk-img'); if (t) t.style.opacity = '0'; ctx.close(); };
  await audio.play();
  tick();
}

/* Hearing: record 16 kHz audio while the mic button is on */
async function toggleMic() {
  const btn = $('#mic-btn');
  if (ui.recording) {
    const rec = ui.recording; ui.recording = null;
    btn.classList.remove('on');
    H.setListening(false);
    rec.stream.getTracks().forEach((t) => t.stop());
    rec.node.disconnect(); await rec.ctx.close();
    const len = rec.chunks.reduce((a, c) => a + c.length, 0);
    const pcm = new Float32Array(len); let o = 0;
    for (const c of rec.chunks) { pcm.set(c, o); o += c.length; }
    if (len < 8000) return;
    toast('Listening to what you said…');
    const r = await H.hear(Array.from(pcm));
    if (!r.ok) { toast('She couldn’t hear: ' + r.reason); return; }
    if (r.text) { ui.autoSpeak = true; await sendTalk(r.text, true); }
    return;
  }
  if (!ui.snap.settings.senses.hearing) { toast('Hearing is turned off on the Body & senses screen.'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    const ctx = new AudioContext({ sampleRate: 16000 });
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(node); node.connect(ctx.destination);
    ui.recording = { stream, ctx, node, chunks };
    btn.classList.add('on');
    H.setListening(true);
  } catch (e) { toast('No microphone: ' + e.message); }
}

async function sendTalk(text, byVoice) {
  if (!text.trim()) return;
  ui.waitingReply = true;
  ui.snap.talk.chat.push({ id: 'tmp', at: Date.now(), role: 'you', text });
  render();
  const reply = await H.talk(text, { voice: !!byVoice });
  ui.waitingReply = false;
  ui.snap = await H.snapshot();
  render();
  if ((byVoice || ui.autoSpeak) && reply && reply.text && !reply.error) { ui.autoSpeak = false; speakText(reply.text); }
}

/* ---------------- events ---------------- */
function go(screen, anchor) {
  if (!SCREENS.includes(screen)) screen = 'mind';
  ui.screen = screen; ui.anchor = anchor || null;
  if (location.hash !== '#' + screen) history.replaceState(null, '', '#' + screen);
  render();
  $('#content').scrollTop = 0; window.scrollTo(0, 0);
}

document.addEventListener('click', async (e) => {
  const nav = e.target.closest('.side a[data-nav]');
  if (nav) { e.preventDefault(); go(nav.getAttribute('data-nav')); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.getAttribute('data-act'), v = el.getAttribute('data-v'), id = el.getAttribute('data-id');
  if (el.tagName === 'A') e.preventDefault();
  const s = ui.snap;
  switch (act) {
    case 'go': go(el.getAttribute('data-to'), el.getAttribute('data-anchor')); break;
    case 'sleep': await H.sleepNow(); toast(s.name + ' is going to sleep.'); break;
    case 'pause': s.status === 'paused' ? await H.resume() : await H.pause(); break;
    case 'mic': toggleMic(); break;
    case 'speak': { const m = s.talk.chat.find((x) => x.id === id); if (m) speakText(m.text); break; }
    case 'redraw': { const r = await H.redrawAvatar(); if (!r.ok) toast('Couldn’t draw her: ' + r.reason); break; }
    case 'savelook': { await saveCreator(); const r = await H.saveLook(); toast(r.ok ? 'Saved. Her new look is drawn.' : 'Saved her look. Drawing failed: ' + r.reason); break; }
    case 'style': await H.setSettings({ avatar: { style: v } }); break;
    case 'framing': await H.setSettings({ avatar: { framing: v } }); toast('Press Redraw her to draw her ' + (v === 'full' ? 'full body.' : 'head and shoulders.')); break;
    case 'roster': await H.setSettings({ avatar: Object.assign({ roster: v }, s.roster[v]) }); rebuild(); break;
    case 'look-yes': await H.answerLook(true); toast('Trying her idea. Redrawing…'); break;
    case 'look-no': await H.answerLook(false); break;
    case 'sample': e.stopPropagation(); { const old = s.avatar.settings.voice; s.avatar.settings.voice = v; await speakText('Hey, it’s ' + s.name + '. This is what I’d sound like.'); s.avatar.settings.voice = old; } break;
    case 'pickvoice': await H.setSettings({ avatar: { voice: v } }); break;
    case 'wish-yes': await H.answerWish(id, 'yes'); toast('She’ll be glad.'); break;
    case 'wish-later': await H.answerWish(id, 'later'); break;
    case 'wish-talk': { const w = s.free.wishes.find((x) => x.id === id); ui.prefill = w ? 'About your wish: “' + w.text + '” — ' : ''; go('talk'); break; }
    case 'openmade': H.openMade(); break;
    case 'exportmem': if (await H.exportMemories()) toast('Memories exported.'); break;
    case 'memfilter': ui.memFilter = v; loadMemories(); break;
    case 'editabout': ui.editingAbout = !ui.editingAbout; render(); break;
    case 'saveabout': for (const inp of document.querySelectorAll('[data-aboutid]')) await H.editMemory(inp.getAttribute('data-aboutid'), inp.value); ui.editingAbout = false; ui.snap = await H.snapshot(); render(); break;
    case 'forgetmode': ui.forgetMode = !ui.forgetMode; ui.memFilter = ui.forgetMode ? ui.memFilter : ui.memFilter; toast(ui.forgetMode ? 'Pick a memory in the timeline and press Forget.' : 'Done forgetting.'); loadMemories(); break;
    case 'forget': if (await H.forgetMemory(id)) { ui.snap = await H.snapshot(); loadMemories(); } break;
    case 'backup': await H.backupNow(); toast('Her mind is backed up.'); break;
    case 'restore': await H.restoreBackup(); break;
    case 'saveidentity': await H.setIdentity({ name: $('#ai-name').value.trim() || s.name, personality: $('#ai-personality').value }); toast('Saved.'); break;
    case 'addfolder': await H.addFolder(); break;
    case 'rmfolder': await H.removeFolder(v); break;
    case 'checkupdate': { const u = await H.checkUpdate(); if (u && u.state === 'available') { toast('Downloading update ' + u.version + '…'); H.downloadUpdate().then(refresh); } setTimeout(refresh, 1500); break; }
    case 'installupdate': await H.installUpdate(); break;
    case 'opendata': H.openData(); break;
    case 'linkfile': H.openLinkFile(); break;
    case 'linkkey': await H.newLinkKey(); toast('New key made. The Command Center picks it up from the key file.'); break;
    case 'growsetup': { const r = await H.growthSetup(); toast(r.ok ? 'Growing is set up.' : 'Setup stopped: ' + r.reason); break; }
    case 'grownow': { const r = await H.growNow(); if (r && r.gen) toast(r.ok ? 'She grew into generation ' + r.gen + '.' : 'Generation ' + r.gen + ' wasn\u2019t better. She kept her current brain.'); else if (r && r.reason) toast(r.reason); break; }
    case 'growstop': await H.growStop(); toast('Stopping after the current step.'); break;
    case 'usegen': await H.useGeneration(Number(v)); toast('Switched her brain.'); break;
    case 'pullbrain': { const r = await H.pullBrain(); toast(r.ok ? 'Her brain is ready.' : 'Download failed: ' + (r.reason || '')); break; }
  }
  refresh();
});

async function saveCreator() {
  const patch = {};
  for (const inp of document.querySelectorAll('[data-avfield]')) patch[inp.getAttribute('data-avfield')] = inp.value;
  await H.setSettings({ avatar: patch });
}

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.matches('[data-sense]')) { await H.setSettings({ senses: { [t.getAttribute('data-sense')]: t.checked } }); }
  else if (t.matches('[data-place]')) { await H.setSettings({ avatar: { places: { [t.getAttribute('data-place')]: t.checked } } }); }
  else if (t.matches('[data-avfield]')) { await saveCreator(); }
  else if (t.matches('[data-set]')) {
    const key = t.getAttribute('data-set');
    let v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value;
    await H.setSettings(setPath(key, v));
  } else return;
  refresh();
});

document.addEventListener('submit', (e) => {
  if (e.target.matches('[data-form="talk"]')) {
    e.preventDefault();
    const ta = $('#talk-input'); const text = ta.value; ta.value = '';
    sendTalk(text, false);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'talk-input' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.form.requestSubmit(); }
});
let searchTimer = null;
document.addEventListener('input', (e) => {
  if (e.target.id === 'mem-search') { clearTimeout(searchTimer); searchTimer = setTimeout(() => { ui.memQuery = e.target.value; loadMemories(); }, 250); }
});

function rebuild() { ui.built = null; }
async function refresh() { ui.snap = await H.snapshot(); if (ui.screen === 'avatar' && document.activeElement && document.activeElement.matches('[data-avfield]')) return; render(); }

H.onSnapshot((s) => { ui.snap = s; if (ui.screen === 'memories' && Date.now() - (ui._memAt || 0) > 15000) { ui._memAt = Date.now(); loadMemories(); } render(); });
H.onNavigate((screen) => go(screen));
window.addEventListener('hashchange', () => go(location.hash.slice(1)));

(async () => {
  ui.snap = await H.snapshot();
  go(location.hash.slice(1) || 'mind');
  if (ui.snap.update && ui.snap.update.state === 'ready') { const b = $('[data-part="installbtn"]'); if (b) b.hidden = false; }
})();
