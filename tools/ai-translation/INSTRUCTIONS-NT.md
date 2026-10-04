# Translating the Gospel of Matthew into Malayalam — instructions for every translator

You are making the "AI translation" of a Malayalam Catholic Bible reading app. Readers will compare
it with Malayalam Catholic (POC) Bibles, so it must be faithful, natural and dignified.

## Source and style
- Translate **from the Greek text of Matthew** (the standard critical text, Nestle–Aland / UBS),
  which you know. Render what the Greek says — faithfully and completely — in natural, dignified
  modern Malayalam that reads well aloud in church. Do not paraphrase, explain, add words the
  Greek doesn't imply, or copy the wording of an existing Malayalam translation.
- **Do not open or copy anything from the app repository** (D:\Sunil\Bible). Work only from your
  knowledge of the Greek text.
- Old Testament quotations: translate them as Matthew quotes them (from his Greek).
- Jesus' sayings: respectful forms for Jesus (അവിടുന്ന് / യേശു അരുളിച്ചെയ്തു / അവൻ is fine in
  narrative, but be consistent within a chapter). "ἀμὴν λέγω ὑμῖν" → "സത്യമായി ഞാൻ നിങ്ങളോടു
  പറയുന്നു".
- Fixed terms, the same everywhere:
  θεός → ദൈവം; κύριος → കർത്താവ്; ὁ πατήρ (God) → പിതാവ്; πνεῦμα ἅγιον → പരിശുദ്ധാത്മാവ്;
  βασιλεία τῶν οὐρανῶν → സ്വർഗരാജ്യം; βασιλεία τοῦ θεοῦ → ദൈവരാജ്യം;
  ὁ υἱὸς τοῦ ἀνθρώπου → മനുഷ്യപുത്രൻ; Χριστός → ക്രിസ്തു; μαθηταί → ശിഷ്യന്മാർ;
  ἀπόστολοι → അപ്പസ്തോലന്മാർ; Φαρισαῖοι → ഫരിസേയർ; Σαδδουκαῖοι → സദുക്കായർ;
  γραμματεῖς → നിയമജ്ഞർ; ἀρχιερεῖς → പ്രധാനപുരോഹിതന്മാർ; πρεσβύτεροι → ജനപ്രമാണികൾ;
  τελῶναι → ചുങ്കക്കാർ; συναγωγή → സിനഗോഗ്; ἱερόν → ദേവാലയം; σάββατον → സാബത്ത്;
  εὐαγγέλιον → സുവിശേഷം; μετανοεῖτε → മാനസാന്തരപ്പെടുവിൻ; δαιμόνια → പിശാചുക്കൾ;
  διάβολος → പിശാച്; Σατανᾶς → സാത്താൻ; γέεννα → നരകം; ᾅδης → പാതാളം; ἀμήν (alone) → ആമേൻ.
- Proper names — use exactly these spellings (Malayalam Catholic usage):
  യേശു, യേശുക്രിസ്തു, മറിയം, ജോസഫ്, യോഹന്നാൻ (the Baptist: സ്നാപകയോഹന്നാൻ), ശിമയോൻ, പത്രോസ്,
  അന്ത്രയോസ്, യാക്കോബ്, സെബദി, പീലിപ്പോസ്, ബർത്തലോമിയോ, തോമസ്, മത്തായി, അൽഫേയൂസ്, തദേവൂസ്,
  യൂദാസ് സ്കറിയോത്താ, ഹേറോദേസ്, ഹേറോദിയാ, അർക്കലാവോസ്, പീലാത്തോസ്, കയ്യാഫാസ്, ബറാബ്ബാസ്,
  മഗ്ദലേന മറിയം, ഏലിയാ, ഏശയ്യാ, ജറെമിയാ, യോനാ, മോശ, അബ്രാഹം, ഇസഹാക്ക്, യാക്കോബ്, ദാവീദ്,
  സോളമൻ, നോഹ, ആബേൽ, സഖറിയാ, ബേൽസെബൂൽ;
  places: ബേത്‌ലെഹെം, നസറത്ത്, ഗലീലി, യൂദയാ, ജറുസലേം, ഈജിപ്ത്, ജോർദാൻ, കഫർണാം, കൊറാസിൻ,
  ബേത്‌സയ്ദാ, സീദോൻ, ടയിർ, സോദോം, ഗൊമോറാ, ദെക്കാപ്പോളിസ്, ബേത്ഫഗെ, ബഥാനിയാ, ഒലിവുമല,
  ഗത്‌സെമനി, ഗൊൽഗോഥാ, സമരിയാ, കാനാൻകാരി (the Canaanite woman), കേസറിയാ ഫിലിപ്പി, ഗദറേനർ.
  For names not in the list, use the usual Malayalam Catholic (POC) form, consistently.

## Verse numbering
- Give **exactly one entry for every verse number you are given**, in order, with only that verse's
  text. Never merge or split verses, never skip one.
- Verses that the critical text omits but Catholic Bibles number (Mt 12:47, 17:21, 18:11, 23:14):
  translate the traditional text and put the whole verse in square brackets [ … ], so the
  numbering stays complete. The doxology at the end of 6:13 is **not** included (as in Catholic
  Bibles).

## Section headings
- `heading` is a short Malayalam section heading printed **before** that verse where a new section
  starts, as printed Bibles have them (e.g. "യേശുവിന്റെ വംശാവലി", "ഗിരിപ്രഭാഷണം", "സുവിശേഷഭാഗ്യങ്ങൾ").
  Use them sparingly — usually 1 to 5 per chapter, normally one on verse 1 — and `""` elsewhere.

## Output: one JSON file per chapter
Write with the Write tool to `<OUTDIR>/MAT_<chapter>.json` (UTF-8), exactly this shape:

```json
{
  "book": "MAT",
  "chapter": 1,
  "verses": [
    { "v": 1, "heading": "യേശുവിന്റെ വംശാവലി", "text": "..." },
    { "v": 2, "heading": "", "text": "..." }
  ]
}
```

- Valid JSON: inside `text` / `heading`, do **not** use straight double quotes `"` — for speech use
  “ ” (and ‘ ’ inside them). No line breaks inside a string.
- Then validate every file you wrote: `node <OUTDIR>/check.cjs MAT_<chapter>.json ...`
  It must print `OK` for each file. Fix and re-check anything it reports. (If the Bash tool fails,
  run it with PowerShell.)
