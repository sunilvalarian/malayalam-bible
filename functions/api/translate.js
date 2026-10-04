// POST /api/translate   (Authorization: Bearer <Firebase ID token>; editors and admins only)
//   body: { book, chapter, verses: [1, 2, …], names: { ml, en }, part, runId?, force? }
//   → { runId, part, nParts, items, done, model }  or  { error } with 4xx / 5xx
// The AI translation of one chapter, made by Claude straight from the original-language text
// (not from the Malayalam translation of the app), and stored in Firestore aiTranslations/{BOOK_CH}.
// A chapter is translated in parts of PART_SIZE verses, one request each, so no request runs long
// and the page can show progress: part 0 starts a new run (and replaces the stored translation),
// parts 1 … nParts-1 add to it in order.
// aiIndex/chapters lists the finished chapters (the ☰ menu's list, one read): a chapter is added when
// its last part is stored, and taken out while it is being made again.
// Configuration (Cloudflare Pages → Settings → Variables and Secrets):
//   ANTHROPIC_API_KEY           Claude API key (console.anthropic.com → API keys)
//   FIREBASE_SERVICE_ACCOUNT    as for the passkeys (the function writes Firestore with it)

import Anthropic from '@anthropic-ai/sdk';
import { json, readJson } from '../_lib/util.js';
import { getConfig, verifyIdToken, fsGet, fsSet, fsUpdate, fieldPath, encodeValue, encodeFields } from '../_lib/firebase.js';

const MODEL = 'claude-opus-5-5';
const EFFORT = 'medium';
const PART_SIZE = 12;          // verses per request
const CONTEXT_VERSES = 3;      // verses of the previous part shown again for continuity
const INDEX = 'aiIndex/chapters';

const SYSTEM = `You translate the Bible into Malayalam for a Catholic Malayalam Bible reading app. The app's main text is a human Malayalam translation; yours is shown next to it, verse by verse, as an independent "AI translation" that readers compare with it.

Translate from the original-language text: the Hebrew / Aramaic (Masoretic) text for the Hebrew Bible; the Greek (Septuagint) for Tobit, Judith, Wisdom, Sirach, Baruch, 1–2 Maccabees and the Greek parts of Esther and Daniel; the Greek for the New Testament. Render what the original says, faithfully and completely, in natural, dignified modern Malayalam that reads well aloud. Do not paraphrase, explain, add words that aren't implied by the original, or copy the wording of an existing Malayalam translation.

Use the names and terms Malayalam Catholics know from the POC Bible (ദൈവം, കർത്താവ് for the divine name, അബ്രാഹം, മോശ, ഇസ്രായേൽ, ജറുസലേം …), and keep them the same throughout the chapter.

Verse numbers follow the app's Catholic numbering, which can differ from the Hebrew; follow the numbers you are given. Give exactly one entry for each requested verse, in order, with only that verse's text — never merge or split verses. "heading" is a short Malayalam section heading to print before the verse where a new section starts (as printed Bibles have them); use them sparingly and leave it "" otherwise.`;

const SCHEMA = {
  type: 'object',
  properties: {
    verses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          v: { type: 'integer', description: 'verse number' },
          heading: { type: 'string', description: 'section heading before this verse, or ""' },
          text: { type: 'string', description: 'the Malayalam translation of this verse' },
        },
        required: ['v', 'heading', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['verses'],
  additionalProperties: false,
};

class Fail extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status || 400; }
}
const check = (cond, code, status) => { if (!cond) throw new Fail(code, status); };
const cleanName = (s) => String(s || '').replace(/[^\p{L}\p{M}\p{N} .'-]/gu, '').trim().slice(0, 40);

const partVerses = (verses, part) => verses.slice(part * PART_SIZE, (part + 1) * PART_SIZE);
// the stored items of one part (parts.p0, parts.p1, …)
const partItems = (doc, part) => ((doc && doc.parts) || {})['p' + part] || null;

async function translatePart(client, req) {
  const { names, chapter, verses, want, before } = req;
  const range = want.length === 1 ? `verse ${want[0]}` : `verses ${want[0]}–${want[want.length - 1]}`;
  let prompt = `Book: ${names.en || names.ml} (${names.ml}), chapter ${chapter}. The chapter has verses ${verses[0]}–${verses[verses.length - 1]} in this numbering.\n\nTranslate ${range}: ${want.join(', ')}.`;
  if (before.length) {
    prompt += `\n\nFor continuity, your translation of the verses just before was:\n` + before.map((x) => `${x.v} ${x.t}`).join('\n');
  }
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // a declined request is re-run on Anthropic's recommended fallback model instead of failing
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  if (res.stop_reason === 'refusal') throw new Fail('refused', 422);
  if (res.stop_reason === 'max_tokens') throw new Fail('too-long', 502);
  // after a fallback only what follows the last switch point is the answer
  const lastSwitch = res.content.map((b) => b.type).lastIndexOf('fallback');
  const text = res.content.slice(lastSwitch + 1).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let out;
  try { out = JSON.parse(text); } catch (e) { throw new Fail('bad-output', 502); }
  const byVerse = new Map();
  for (const x of (out && out.verses) || []) {
    if (Number.isInteger(x.v) && typeof x.text === 'string' && x.text.trim() && !byVerse.has(x.v)) byVerse.set(x.v, x);
  }
  check(want.every((v) => byVerse.has(v)), 'bad-output', 502);
  // the reader's format: { h } = section heading, { v, t, p } = verse (p: starts a paragraph)
  const items = [];
  want.forEach((v, i) => {
    const x = byVerse.get(v);
    const h = String(x.heading || '').trim().slice(0, 200);
    if (h) items.push({ h });
    const it = { v, t: x.text.trim().slice(0, 4000) };
    if (h || (i === 0 && req.first)) it.p = 1;
    items.push(it);
  });
  return { items, model: res.model };
}

export async function onRequestPost({ request, env }) {
  const cfg = getConfig(env);
  if (!cfg || !env.ANTHROPIC_API_KEY) return json({ error: 'translate-not-configured' }, 503);
  try {
    // 1. who is asking: editors and admins only (AI translation costs money per chapter)
    const auth = request.headers.get('Authorization') || '';
    const who = await verifyIdToken(cfg, auth.replace(/^Bearer\s+/i, ''));
    check(who, 'not-signed-in', 401);
    const profile = await fsGet(cfg, 'users/' + who.uid);
    check(profile && ['editor', 'admin'].includes(profile.role), 'not-allowed', 403);

    // 2. the request
    let body;
    try { body = await readJson(request); } catch (e) { throw new Fail('bad-request'); }
    check(body && typeof body === 'object', 'bad-request');
    const book = String(body.book || '');
    const chapter = body.chapter;
    const verses = body.verses;
    const part = body.part;
    check(/^[1-4]?[A-Z]{2,3}$/.test(book), 'bad-request');
    check(Number.isInteger(chapter) && chapter >= 1 && chapter <= 200, 'bad-request');
    check(Array.isArray(verses) && verses.length >= 1 && verses.length <= 200, 'bad-request');
    check(verses.every((v, i) => Number.isInteger(v) && v >= 1 && v <= 200 && (i === 0 || v > verses[i - 1])), 'bad-request');
    const nParts = Math.ceil(verses.length / PART_SIZE);
    check(Number.isInteger(part) && part >= 0 && part < nParts, 'bad-request');
    const names = { ml: cleanName(body.names && body.names.ml), en: cleanName(body.names && body.names.en) };
    check(names.ml || names.en, 'bad-request');

    const path = `aiTranslations/${book}_${chapter}`;
    const doc = await fsGet(cfg, path);
    let runId = String(body.runId || '');
    let before = [];
    if (part === 0) {
      // a finished translation is replaced only when asked to (it was paid for once already)
      check(!(doc && doc.done) || body.force === true, 'exists', 409);
      runId = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
    } else {
      // parts go in order, within one run (another editor may have started a new run meanwhile)
      check(doc && doc.runId === runId && doc.nParts === nParts, 'superseded', 409);
      const prev = partItems(doc, part - 1);
      check(prev, 'out-of-order', 409);
      before = prev.filter((x) => x.v).slice(-CONTEXT_VERSES);
    }

    // 3. Claude
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 5 * 60 * 1000 });
    let out;
    try {
      out = await translatePart(client, { names, chapter, verses, want: partVerses(verses, part), before, first: part === 0 });
    } catch (e) {
      if (e instanceof Fail) throw e;
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        console.error('translate: API key', e.status);
        throw new Fail('translate-not-configured', 503);
      }
      if (e instanceof Anthropic.RateLimitError) throw new Fail('busy', 429);
      if (e instanceof Anthropic.APIError && (e.status === 529 || e.status >= 500)) throw new Fail('busy', 503);
      console.error('translate: Claude', e);
      throw new Fail('ai-error', 502);
    }

    // 4. store it (the rules let nobody else write aiTranslations)
    const now = new Date();
    const done = part === nParts - 1;
    if (part === 0) {
      await fsSet(cfg, path, encodeFields({
        book, chapter, runId, nParts, verses: verses.length, parts: { p0: out.items }, done,
        model: out.model, createdBy: who.email, createdAt: now, updatedAt: now,
      }));
    } else {
      // the run may have been replaced while Claude was working: check again just before writing
      const latest = await fsGet(cfg, path);
      check(latest && latest.runId === runId, 'superseded', 409);
      await fsUpdate(cfg, path, {
        ['parts.p' + part]: encodeValue(out.items), done: encodeValue(done),
        model: encodeValue(out.model), updatedAt: encodeValue(now),
      });
    }
    // the list of finished chapters
    const entry = done ? encodeValue({ book, chapter, verses: verses.length, model: out.model, at: now }) : undefined;
    if (done || part === 0) await fsUpdate(cfg, INDEX, { [fieldPath('chapters', `${book}_${chapter}`)]: entry }, { mustExist: false });
    return json({ runId, part, nParts, items: out.items, done, model: out.model });
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.code }, e.status);
    console.error('translate', e);
    return json({ error: 'server-error' }, 500);
  }
}
