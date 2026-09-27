// GET /api/passkey/challenge → { challenge, token }
// A random WebAuthn challenge plus a stateless token: HMAC-SHA256 over { c: challenge, exp }.
// verify.js checks the token, so no server-side session storage is needed.

import { json, b64url, enc, hmacSign } from '../../_lib/util.js';
import { getConfig, challengeKey } from '../../_lib/firebase.js';

const CHALLENGE_TTL = 5 * 60 * 1000;

export async function onRequestGet({ env }) {
  const cfg = getConfig(env);
  if (!cfg) return json({ error: 'passkey-not-configured' }, 503);
  try {
    const challenge = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const payload = b64url(JSON.stringify({ c: challenge, exp: Date.now() + CHALLENGE_TTL }));
    const sig = b64url(await hmacSign(await challengeKey(cfg, env), enc.encode(payload)));
    return json({ challenge, token: payload + '.' + sig });
  } catch (e) {
    console.error('passkey challenge', e);
    return json({ error: 'server-error' }, 500);
  }
}
