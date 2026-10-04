# AI translation sources

One JSON file per chapter (`GEN_1.json`, `MAT_5.json`, `1CO_13.json`, …), translated by Claude from the
Hebrew / Greek original:

```json
{ "book": "MAT", "chapter": 1, "verses": [{ "v": 1, "heading": "", "text": "…" }] }
```

- `INSTRUCTIONS*.md`: the translation rules every chapter followed (source text, fixed terms, name
  spellings, verse numbering, bracketed verses, headings).
- `check.cjs`: validator — `node check.cjs MAT_1.json …` (verse counts per book, keys, Malayalam text).
- Rebuild the app's bundle (`app/js/ai-data.js`) from here, listing only finished books:

```
node tools/build-ai-data.js tools/ai-translation claude-opus-5-5 GEN,MAT,MRK,LUK,JHN,ACT,ROM,1CO,2CO,GAL
```

To correct a verse, edit its chapter file here, run `check.cjs` on it, rebuild, and commit both.
Cloudflare Pages serves only `app/`, so this folder isn't published.
