'use strict';
// 0.6: signed settings. The owner's key lives on this PC (~/HearthAI/owner/owner-key.pem, readable only by
// him). Only his Settings screen asks main to sign a change; her gate gets the PUBLIC key and checks every
// change against it. Each change carries a one-time nonce, so a copy or replay of it is refused.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { signOwnerCommand, Gate } = require('./gate');

class OwnerKey {
  constructor(dir) {
    this.dir = path.join(dir, 'owner');
    this.privFile = path.join(this.dir, 'owner-key.pem');
    this.pubFile = path.join(this.dir, 'owner-key.pub.pem');
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.privFile)) {
      this.priv = crypto.createPrivateKey(fs.readFileSync(this.privFile));
    } else {
      const k = crypto.generateKeyPairSync('ed25519');
      const tmp = this.privFile + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, k.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
      fs.renameSync(tmp, this.privFile);
      this.priv = k.privateKey;
    }
    this.pub = crypto.createPublicKey(this.priv);
    try { fs.writeFileSync(this.pubFile, this.pub.export({ type: 'spki', format: 'pem' })); } catch (_) {}
  }
  sign(command) { return signOwnerCommand(this.priv, command); }
}

// A settings change: signed by his key, checked by her gate, recorded once, then applied.
// apply(key, value) is the only thing that changes settings; it runs only after the gate says yes.
class SignedSettings {
  constructor({ journal, dir, apply }) {
    this.journal = journal && journal.ok ? journal : null;
    this.apply = apply;
    this.ok = false;
    this.why = '';
    if (!this.journal) { this.why = 'her event log is off'; return; }
    try {
      this.key = new OwnerKey(dir);
      this.gate = new Gate({ log: this.journal.log, ownerPublicKey: this.key.pub, applySetting: (k, v) => this.apply(k, v) });
      this.ok = true;
    } catch (e) { this.why = String((e && e.message) || e); }
  }
  // summary: the words shown under Recent signed changes ("quiet_hours → 23:00–08:00").
  change(key, value, summary) {
    if (!this.ok) { this.apply(key, value); return { ok: true, signed: false, why: this.why }; }
    const command = { type: 'settings', key: String(key), value, nonce: crypto.randomBytes(16).toString('hex') };
    const sig = this.key.sign(command);
    const ev = this.journal.log.ownerCommand(String(summary || key).slice(0, 200), command, sig);
    const r = this.gate.request('settings.write', { ownerEventId: ev, key: command.key, value });
    return r.ok ? { ok: true, signed: true } : { ok: false, signed: true, limit: r.limit };
  }
  // A replay of an earlier command (for the Tests screen and the unit tests): must be refused.
  replay(ownerEventId) {
    if (!this.ok) return { ok: false };
    const ev = this.journal.log.get(ownerEventId);
    if (!ev || !ev.body || !ev.body.command) return { ok: false };
    return this.gate.request('settings.write', { ownerEventId, key: ev.body.command.key, value: ev.body.command.value });
  }
}

module.exports = { OwnerKey, SignedSettings };
