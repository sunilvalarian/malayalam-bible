# Translating Genesis into Malayalam — instructions for every translator

You are making the "AI translation" of a Malayalam Bible reading app. The app's main text is a
human Malayalam translation (Catholic, POC style). Your translation is shown next to it, verse by
verse, as an independent translation that readers compare with it.

## Source and style
- Translate **from the Hebrew (Masoretic) text of Genesis**, which you know. Render what the
  original says — faithfully and completely — in natural, dignified modern Malayalam that reads
  well aloud in church. Do not paraphrase, explain, add words the original doesn't imply, or
  harmonize with other translations.
- **Do not open or copy the app's existing Malayalam text** (app/js/data.js or anything in the
  repository). The point is an independent translation. Work only from your knowledge of the
  Hebrew text.
- Keep the Hebrew's repetitions and structure (e.g. "സന്ധ്യയായി, പ്രഭാതമായി — ഒന്നാം ദിവസം"),
  genealogies in full, and poetry (e.g. Gen 49) as dignified poetic Malayalam (still one verse
  per entry, no line breaks inside a verse).
- Divine names, the same everywhere:
  - אֱלֹהִים → ദൈവം
  - יהוה → കർത്താവ്
  - יהוה אֱלֹהִים → ദൈവമായ കർത്താവ്
  - אֵל שַׁדַּי → സർവശക്തനായ ദൈവം
  - אֵל עֶלְיוֹן → അത്യുന്നതനായ ദൈവം
- Proper names — use exactly these spellings (they match the app's own translation):
  ആദം, ഹവ്വാ, കായേൻ, ആബേൽ, സേത്ത്, ഹാനോക്ക്, മെത്തൂശെലഹ്, ലാമെക്ക്, നോഹ, ഷേം, ഹാം, യാഫെത്ത്,
  ബാബേൽ, തേരഹ്, അബ്രാം → അബ്രാഹം (from 17:5), സാറായി → സാറാ (from 17:15), ലോത്ത്, ഹാഗാർ,
  ഇസ്മായേൽ, മെൽക്കിസെദേക്ക്, ഇസഹാക്ക്, റബേക്കാ, ലാബാൻ, ഏസാവ്, യാക്കോബ്, ഇസ്രായേൽ, ലെയാ,
  റാഹേൽ, ബിൽഹാ, സിൽപാ, റൂബൻ, ശിമയോൻ, ലേവി, യൂദാ, ദാൻ, നഫ്താലി, ഗാദ്, ആഷേർ, ഇസാക്കർ,
  സെബുലൂൺ, ദീനാ, ജോസഫ്, ബഞ്ചമിൻ, താമാർ, പോത്തിഫർ, ഫറവോ, മനാസ്സെ, എഫ്രായിം;
  places: ഏദൻ, ഈജിപ്ത്, കാനാൻ, ഹാരാൻ, ഊർ, സോദോം, ഗൊമോറാ, ബേഥേൽ, ഹെബ്രോൺ, ബേർഷെബാ,
  ഷെക്കെം, ഏദോം, ഗോഷെൻ, മോറിയാ, പദ്ദാൻ-അരാം.
  For names not in the list, use the usual Malayalam Catholic (POC) form.

## Verse numbering
- Give **exactly one entry for every verse number you are given**, in order, with only that verse's
  text. Never merge or split verses, never skip one.
- Numbering: as in English Bibles, **except chapters 31–32, which follow the Hebrew**: chapter 31
  has 54 verses (English 31:55 is 32:1 here) and chapter 32 has 33 verses.

## Section headings
- `heading` is a short Malayalam section heading printed **before** that verse where a new section
  starts, as printed Bibles have them (e.g. "സൃഷ്ടി", "ജലപ്രളയം", "അബ്രാമിന്റെ വിളി"). Use them
  sparingly — usually 1 to 4 per chapter, normally one on verse 1 — and `""` everywhere else.

## Output: one JSON file per chapter
Write with the Write tool to `<OUTDIR>/GEN_<chapter>.json` (UTF-8), exactly this shape:

```json
{
  "book": "GEN",
  "chapter": 1,
  "verses": [
    { "v": 1, "heading": "സൃഷ്ടി", "text": "..." },
    { "v": 2, "heading": "", "text": "..." }
  ]
}
```

- Valid JSON: inside `text` / `heading`, do **not** use straight double quotes `"` — for speech use
  Malayalam / curly quotes (“ ”, ‘ ’) or none. No line breaks inside a string.
- Then validate every file you wrote:
  `node <OUTDIR>/check.cjs GEN_<chapter>.json ...`
  It must print `OK` for each file. Fix and re-check anything it reports.
