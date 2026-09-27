// POST /api/passkey/verify
//   body: { token, id, clientDataJSON, authenticatorData, signature, userHandle }  (base64url)
//   → { token: <Firebase custom token> }  or  { error } with 4xx / 5xx
// Checks a WebAuthn assertion (discoverable passkey) against the public key stored in
// Firestore passkeys/{id}, then mints a Firebase custom token for the passkey's owner.

import { json, enc, dec, b64urlDecode, b64decode, concat, equalBytes, sha256, derToRaw, readJson } from '../../_lib/util.js';
import { getConfig, challengeKey, fsGet, fsUpdate, fsCreate, customToken } from '../../_lib/firebase.js';

class Fail extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status || 401; }
}
const check = (cond, code, status) => { if (!cond) throw new Fail(code, status); };

async function verifySignature(alg, spki, sig, data) {
  if (alg === -7) {
    const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(sig, 32), data);
  }
  if (alg === -257) {
    const key = await crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
  }
  throw new Fail('unsupported-algorithm');
}

export async function onRequestPost({ request, env }) {
  const cfg = getConfig(env);
  if (!cfg) return json({ error: 'passkey-not-configured' }, 503);
  try {
    let body;
    try { body = await readJson(request); } catch (e) { throw new Fail('bad-request', 400); }
    check(body && typeof body === 'object', 'bad-request', 400);
    const url = new URL(request.url);

    // 1. the challenge token we issued (signature + expiry)
    const parts = String(body.token || '').split('.');
    check(parts.length === 2, 'bad-token');
    let tok;
    try {
      const ok = await crypto.subtle.verify('HMAC', await challengeKey(cfg, env), b64urlDecode(parts[1]), enc.encode(parts[0]));
      check(ok, 'bad-token');
      tok = JSON.parse(dec.decode(b64urlDecode(parts[0])));
    } catch (e) { if (e instanceof Fail) throw e; throw new Fail('bad-token'); }
    check(tok && typeof tok.c === 'string' && typeof tok.exp === 'number', 'bad-token');
    check(Date.now() <= tok.exp, 'expired');

    // 2. client data: an assertion, for our challenge, made on this site
    let cdBytes, cd, ad, sig;
    try {
      cdBytes = b64urlDecode(body.clientDataJSON);
      cd = JSON.parse(dec.decode(cdBytes));
      ad = b64urlDecode(body.authenticatorData);
      sig = b64urlDecode(body.signature);
    } catch (e) { throw new Fail('bad-request', 400); }
    check(cd.type === 'webauthn.get', 'bad-type');
    check(cd.challenge === tok.c, 'bad-challenge');
    check(cd.origin === url.origin, 'bad-origin');

    // 3. authenticator data: rpIdHash = SHA-256(host name), user present
    check(ad.length >= 37, 'bad-request', 400);
    check(equalBytes(ad.subarray(0, 32), await sha256(url.hostname)), 'bad-rp');
    check((ad[32] & 0x01) === 0x01, 'user-not-present');
    const counter = new DataView(ad.buffer, ad.byteOffset + 33, 4).getUint32(0);

    // 4. the stored passkey
    const id = String(body.id || '');
    check(/^[A-Za-z0-9_-]{16,700}$/.test(id), 'bad-request', 400);
    const pk = await fsGet(cfg, 'passkeys/' + id);
    check(pk && typeof pk.uid === 'string' && pk.uid && typeof pk.publicKey === 'string', 'unknown-passkey');
    if (body.userHandle) {
      let handle = '';
      try { handle = dec.decode(b64urlDecode(body.userHandle)); } catch (e) { /* checked below */ }
      check(handle === pk.uid, 'bad-user');
    }

    // 5. signature over authenticatorData || SHA-256(clientDataJSON)
    const signed = concat(ad, await sha256(cdBytes));
    let valid = false;
    try { valid = await verifySignature(pk.alg, b64decode(pk.publicKey), sig, signed); } catch (e) { if (e instanceof Fail) throw e; valid = false; }
    check(valid, 'bad-signature');

    // 6. signature counter must grow (synced passkeys always report 0)
    const stored = Number(pk.counter) || 0;
    check((counter === 0 && stored === 0) || counter > stored, 'counter');

    // 7. each challenge works once
    const now = new Date();
    const fresh = await fsCreate(cfg, 'passkeyChallenges', tok.c, {
      usedAt: { timestampValue: now.toISOString() },
      expireAt: { timestampValue: new Date(tok.exp + 24 * 3600 * 1000).toISOString() },
    });
    check(fresh, 'replay');

    // 8. blocked accounts can't sign in with a passkey
    const profile = await fsGet(cfg, 'users/' + pk.uid).catch(() => null);
    check(!profile || profile.role !== 'none', 'blocked', 403);

    await fsUpdate(cfg, 'passkeys/' + id, {
      counter: { integerValue: String(counter) },
      lastUsedAt: { timestampValue: now.toISOString() },
    });
    return json({ token: await customToken(cfg, pk.uid) });
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.code }, e.status);
    console.error('passkey verify', e);
    return json({ error: 'server-error' }, 500);
  }
}
