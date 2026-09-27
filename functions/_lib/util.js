// Shared helpers for the passkey Pages Functions. Web APIs only (Workers / Node 20+):
// crypto.subtle, TextEncoder, atob / btoa. No npm dependencies.

export const enc = new TextEncoder();
export const dec = new TextDecoder();

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export function toBytes(x) {
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  if (typeof x === 'string') return enc.encode(x);
  throw new TypeError('bytes expected');
}

export function b64encode(buf) {
  const b = toBytes(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64decode(str) {
  const bin = atob(String(str).replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const b64url = (buf) => b64encode(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function b64urlDecode(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str)) throw new Error('bad base64url');
  const t = str.replace(/-/g, '+').replace(/_/g, '/');
  return b64decode(t + '==='.slice((t.length + 3) % 4));
}

export function concat(...parts) {
  const bs = parts.map(toBytes);
  const out = new Uint8Array(bs.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of bs) { out.set(b, o); o += b.length; }
  return out;
}

export function equalBytes(a, b) {
  a = toBytes(a); b = toBytes(b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', toBytes(data)));
}

export async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', toBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function hmacSign(key, data) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, toBytes(data)));
}

// ECDSA signatures from authenticators are DER encoded: SEQUENCE { INTEGER r, INTEGER s }.
// WebCrypto wants the raw r || s form (32 + 32 bytes for P-256).
export function derToRaw(der, size = 32) {
  const b = toBytes(der);
  let i = 0;
  if (b[i++] !== 0x30) throw new Error('bad signature');
  let len = b[i++];
  if (len & 0x80) i += len & 0x7f;           // long-form length (not expected for P-256)
  const readInt = () => {
    if (b[i++] !== 0x02) throw new Error('bad signature');
    let n = b[i++];
    let v = b.subarray(i, i + n);
    i += n;
    while (v.length > size && v[0] === 0) v = v.subarray(1);
    if (v.length > size) throw new Error('bad signature');
    const out = new Uint8Array(size);
    out.set(v, size - v.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  return concat(r, s);
}

export function pemToDer(pem) {
  const body = String(pem).replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
  return b64decode(body);
}

export async function readJson(request, max = 16384) {
  const text = await request.text();
  if (text.length > max) throw new Error('too-large');
  return JSON.parse(text);
}
