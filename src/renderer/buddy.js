'use strict';
const pic = document.getElementById('pic');
const btn = document.getElementById('talk');
function show(s) {
  const p = s.avatar.portrait;
  if (p && s.avatar.settings.style !== 'Moon orb') { pic.className = 'pic'; pic.style.backgroundImage = "url('" + p + "')"; }
  else { pic.className = 'pic orb'; pic.style.backgroundImage = ''; }
  btn.textContent = s.name + ' · ' + (s.status === 'awake' ? (s.current.mood || 'awake') : s.status);
  pic.setAttribute('aria-label', s.name + ', ' + s.avatar.expression.toLowerCase());
}
btn.addEventListener('click', () => window.hearth.showWindow('talk'));
pic.addEventListener('dblclick', () => window.hearth.showWindow('talk'));
window.hearth.onSnapshot(show);
window.hearth.snapshot().then(show);
