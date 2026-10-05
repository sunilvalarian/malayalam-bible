# Notes for Claude

Malayalam Bible reader: a static site in `app/` (Cloudflare Pages), Firebase for login and shared edits. The README describes everything; the user writes in Malayalam / Manglish.

## Processing uploaded source files
"Process the uploads" means the files people sent from ☰ → *ഉറവിട ഫയലുകൾ സൂക്ഷിക്കുക*. They are in `tools/uploads/<BOOK ID>/<chapter>/<UTC time>-<name>` (no chapter folder = chapter not given). Everything still in `tools/uploads/` is waiting.

1. `git pull` first: on the published site each upload is its own commit on `main`. `git log --format='%h %ad%n%B' -- tools/uploads` shows who sent each file and their note (pages, where a chapter starts, …).
2. Per book and chapter, in file-name (= upload) order:
   - **PDF with real Malayalam text** (`app/js/pdf-extract.js` gets text out of it): `git mv` it to `tools/sources/<BOOK>/അധ്യായം <N>.pdf`; `tools/build-data.js` reads it. Corrections go in `tools/text-fixes.js` under the book id.
   - **Photos, scanned PDFs, Word or text files**: read them and type the chapter into `tools/sources/<BOOK>/<N>.txt` in the editor format: `## heading`, `[5]` starts verse 5, one line per paragraph. Leave out cross-references, footnotes and page headers/numbers, like `tools/sources/MAT/17.txt` … `28.txt`. A chapter can run over several photos, and one photo can hold the end of one chapter and the start of the next. Say which verses are unreadable or missing instead of guessing.
   - Then `git mv` the originals to `tools/sources/<BOOK>/originals/` (build-data ignores sub-folders), so `tools/uploads/` only holds what is still waiting.
   - Genesis (`GEN`) is the main book, built from the PDFs in the repository root; build-data ignores `tools/sources/GEN/`. For Genesis, fix text through `tools/text-fixes.js` or ask the user.
3. `node tools/build-data.js` and check its report for the new chapters (verse counts, missing / out-of-order verses).
4. Note new or changed chapters in the README section *Rebuilding the bundled text from the PDFs* (what was typed, what is missing).
5. Commit (the moved originals, the `.txt` / PDFs and `app/js/data.js`) and push only when the user asks.

## Tests
`cd tests && npm run test:unit` (no emulator needed). The rules / e2e tests need Java for the Firebase emulator.
