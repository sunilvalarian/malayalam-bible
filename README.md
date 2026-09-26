# Malayalam Bible reader

Open **`app/index.html`** in Chrome or Edge (double-click works, no server needed).

## Features
- **Reading**: chapter title, section headings, superscript verse numbers. Swipe or use ← → (or the round buttons) to change chapter. The app remembers where you stopped.
- **Chapter / verse navigation**: tap the `ഉത്പത്തി 1 ▾` button. At the top, pick **പുസ്തകം / അധ്യായം / വാക്യം** together from three dropdowns and press പോകുക. Below that are Book → Chapter → Verse grids, or type a reference: `3`, `3:15`, `3 15`, `12:1-5`, `ഉത്പ 22:2`, `gen 3:15`.
- **Word search** (🔍 or `/`): finds partial words (`അനുഗ്രഹ`). Several words must all appear in the verse. Use `"quotes"` for an exact phrase. "Whole word" option. Search all books, this book, or this chapter.
- **Tap a verse**: highlight (5 colours), copy, share, bookmark, note, edit. Lists are under ☰ → My library.
- **Aa**: font size, line spacing, 4 Malayalam fonts, Light / Sepia / Dark / Auto themes, paragraph or verse-per-line layout.
- **Editing**: ☰ → *ഈ അധ്യായം തിരുത്തുക* opens a side-by-side editor with live preview. Format: `[5]` starts verse 5, `## text` is a heading, each line is a paragraph. The editor warns about missing or out-of-order verse numbers. *യഥാർത്ഥം* restores the original PDF text.
- **PDF upload**: ☰ → *PDF അപ്‌ലോഡ്*. Drop one or more PDFs. The book and chapter number are detected (from the file name or an `അധ്യായം N` header) and can be changed. Preview, then save. The chapter becomes part of the reader, and ☰ → *HTML ആയി ഡൗൺലോഡ്* exports a whole book as a single HTML file.

## Login and permissions
The published site can use Firebase for login. Permissions are enforced on Firebase's servers by [`firestore.rules`](firestore.rules), so they can't be bypassed from the page source.

| | Not logged in | Reader | Editor | Admin |
|---|:-:|:-:|:-:|:-:|
| Read, search | ✓ | ✓ | ✓ | ✓ |
| Own highlights / bookmarks / notes synced across devices | | ✓ | ✓ | ✓ |
| Edit verses and chapters, upload PDFs, restore original, export data.js | | | ✓ | ✓ |
| Delete chapters, reset all edits | | | | ✓ |
| Manage users and roles, invites, activity log | | | | ✓ |

- New accounts start as **Reader**. An admin gives roles in ☰ → *ഉപയോക്താക്കളും അനുമതികളും*: change a user's role directly, or **invite** an email as Editor/Admin before they sign up. The invite applies once they log in with that email and verify it.
- `sunilvalarian@gmail.com` is always **Admin** once its email is verified. Change this in both `firestore.rules` and `app/js/firebase-config.js`.
- Edits by editors are saved to Firestore and show up live for everyone.
- Opening `app/index.html` from disk (or with no Firebase config) is **local mode**: no login, everything allowed, changes stay in that browser.

### One-time Firebase setup
1. Go to https://console.firebase.google.com and create a project (Google Analytics can be off).
2. **Build → Authentication → Get started → Sign-in method**: enable **Email/Password** and **Google**.
3. **Authentication → Settings → Authorized domains**: add `sunilvalarian.github.io`.
4. **Build → Firestore Database → Create database**: *production mode*, location `asia-south1 (Mumbai)`.
5. **Firestore → Rules**: replace the contents with [`firestore.rules`](firestore.rules) and click **Publish**. Do this again whenever that file changes.
6. **Project settings (⚙) → General → Your apps → Web (`</>`)**: register an app, then copy the `firebaseConfig` object into `app/js/firebase-config.js` as `window.FIREBASE_CONFIG = { … }`. These values are not secret.
7. Commit and push. Then open the site, sign up with the owner email, and verify it. You're Admin.

### Testing locally with the Firebase emulator
```
firebase emulators:start --only auth,firestore --project demo-bible   # uses firebase.json + firestore.rules
# serve the folder over http (login does not work from file://), then open:
#   http://127.0.0.1:5500/app/?emulator
```

## Where changes are stored
In local mode, edits, uploads, highlights and notes are saved in the browser's localStorage, on this computer and in this browser only. In login mode, chapter edits live in Firestore and personal data syncs to the user's account. To keep a copy in the repository:
- ☰ → **data.js എക്സ്പോർട്ട്** downloads a new `data.js`. Replace `app/js/data.js` with it, and the edits become part of the app for everyone who opens it.
- ☰ → **ബാക്കപ്പ്** downloads a `.json` backup of everything (restore it from the same menu).

## Rebuilding the bundled text from the PDFs
```
node tools/build-data.js            # reads the PDFs in this folder → app/js/data.js
```
This prints a report per chapter (verses found, headings, missing verse numbers). Several source PDFs have missing verse numbers, e.g. ch 2 (10–22), ch 13 (2–5, 8–9), ch 16, ch 17. These come out in the text without a number; fix them with the editor.

## Notes on PDFs
The extractor (`app/js/pdf-extract.js`) reads the Unicode text that Google Docs / Chrome embed in the PDF (`ActualText`). Generic tools such as pdf.js scramble this Malayalam text. Scanned (image) PDFs and PDFs that use old ASCII Malayalam fonts (ML-TT etc.) have no usable text, and the upload dialog will say so.
