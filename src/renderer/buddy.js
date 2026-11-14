'use strict';
// Desktop buddy: her drawn picture, or her live 3D / Live2D body standing (or
// sitting) on the desktop. She can move it herself, and look at it.
const H = window.hearth;
const pic = document.getElementById('pic');
const host = document.getElementById('host');
const btn = document.getElementById('talk');
let stage = null, key = null, loading = false;

function live(s) { const t = s.avatar.settings.bodyType; return (t === 'vrm' || t === 'live2d') && s.models && s.models.current && (t !== 'live2d' || s.models.coreUrl); }

async function show(s) {
  btn.textContent = s.name + ' · ' + (s.status === 'awake' ? (s.current.mood || 'awake') : s.status);
  if (live(s)) {
    pic.style.display = 'none';
    const k = s.models.current.kind + '|' + s.models.current.url;
    if (k !== key && !loading) {
      if (stage) { stage.destroy(); stage = null; }
      key = k; loading = true;
      try { stage = await AvatarStage.create(host, { kind: s.models.current.kind, url: s.models.current.url, coreUrl: s.models.coreUrl, camera: 'full', interactive: false, smooth: s.avatar.settings.smooth !== false, faces: s.avatar.settings.faces, mood: s.avatar.expression }); }
      catch (_) { key = null; }
      loading = false;
    }
    if (stage) {
      stage.setMood(s.avatar.expression, Object.assign({}, AvatarStage.DEFAULT_FACES, s.avatar.settings.faces || {}));
      stage.setPose(s.avatar.settings.buddyPose === 'sit' ? 'sit' : null);
      stage.setIntent(s.avatar.intent);
      stage.setLookAtUser(!!s.avatar.talking);
    }
    return;
  }
  if (stage) { stage.destroy(); stage = null; key = null; }
  pic.style.display = '';
  const p = s.avatar.portrait;
  if (p && s.avatar.settings.bodyType === 'drawn') { pic.className = 'pic'; pic.style.backgroundImage = "url('" + p + "')"; pic.style.backgroundSize = s.avatar.settings.framing === 'portrait' ? '115% auto' : 'contain'; pic.style.backgroundPosition = s.avatar.settings.framing === 'portrait' ? 'center 8%' : 'center bottom'; pic.style.backgroundColor = 'transparent'; pic.style.border = 'none'; pic.style.boxShadow = 'none'; }
  else { pic.className = 'pic orb'; pic.style.backgroundImage = ''; }
  pic.setAttribute('aria-label', s.name + ', ' + s.avatar.expression.toLowerCase());
}
btn.addEventListener('click', () => H.showWindow('talk'));
host.addEventListener('dblclick', () => H.showWindow('talk'));
pic.addEventListener('dblclick', () => H.showWindow('talk'));
H.onCapture(() => H.sendCapture(stage ? stage.snapshot() : null));
H.onSnapshot(show);
H.snapshot().then(show);
setInterval(() => { if (stage) { const d = stage.snapshot(); if (d) H.saveLive(d); } }, 30000);
