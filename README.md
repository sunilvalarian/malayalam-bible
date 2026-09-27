# Malayalam Bible reader

Open **`app/index.html`** in Chrome or Edge (double-click works, no server needed). Editing, uploads and the data tools need a login (or, without Firebase, the local owner passcode — see [Login and permissions](#login-and-permissions)).

## Features
- **Reading**: chapter title, section headings, superscript verse numbers. Swipe or use ← → (or the round buttons) to change chapter. The app remembers where you stopped.
- **Chapter / verse navigation**: tap the `ഉത്പത്തി 1 ▾` button. At the top, pick **പുസ്തകം / അധ്യായം / വാക്യം** together from three dropdowns and press പോകുക. Below that are Book → Chapter → Verse grids, or type a reference: `3`, `3:15`, `3 15`, `12:1-5`, `ഉത്പ 22:2`, `gen 3:15`.
- **Word search** (🔍 or `/`): finds partial words (`അനുഗ്രഹ`). Several words must all appear in the verse. Use `"quotes"` for an exact phrase. "Whole word" option. Search all books, this book, or this chapter.
- **Tap a verse**: highlight (5 colours), copy, share, bookmark, note, edit. Lists are under ☰ → My library.
- **Aa**: font size, line spacing, 4 Malayalam fonts, Light / Sepia / Dark / Auto themes, paragraph or verse-per-line layout.
- **Editing**: ☰ → *ഈ അധ്യായം തിരുത്തുക* opens a side-by-side editor with live preview. Format: `[5]` starts verse 5, `## text` is a heading, each line is a paragraph. The editor warns about missing or out-of-order verse numbers. *യഥാർത്ഥം* restores the original PDF text.
- **PDF upload**: ☰ → *PDF അപ്‌ലോഡ്*. Drop one or more PDFs. The book and chapter number are detected (from the file name or an `അധ്യായം N` header) and can be changed. Preview, then save. The chapter becomes part of the reader, and ☰ → *HTML ആയി ഡൗൺലോഡ്* exports a whole book as a single HTML file.

## Hosting
The GitHub repository is **private**: nobody can download the source, the PDFs or the history. The website is published by **Cloudflare Pages**, which serves only the `app/` folder and redeploys automatically on every `git push` to `main`.

One-time Cloudflare setup:
1. Sign in at https://dash.cloudflare.com (free account).
2. Go to **Workers & Pages → Create → Pages → Connect to Git**. If you only see Workers, click the "Looking to deploy Pages? Get started" link.
3. Authorize GitHub and allow access to **only** the `malayalam-bible` repository.
4. Select the repository, then enter:
   - Production branch: `main`
   - Framework preset: `None`
   - Build command: *(leave empty)*
   - Build output directory: `app`
5. Click **Save and Deploy**. The site appears at `https://<project-name>.pages.dev`.

`app/_headers` sets the response headers (the service worker is never cached, so updates reach installed phones).

The `functions/` folder (at the repository root, next to `app/`) holds the Cloudflare Pages Functions for passkey sign-in (`/api/passkey/challenge`, `/api/passkey/verify`). Pages deploys them automatically; they need the secrets described under *Passkey* below and return "not configured" until then.

## Login and permissions
The published site can use Firebase for login. Permissions are enforced on Firebase's servers by [`firestore.rules`](firestore.rules), so they can't be bypassed from the page source. In the ☰ menu, the whole **ഉള്ളടക്കം** and **ഡാറ്റ** sections are shown only to people who have the permission; the same check guards the buttons, keyboard shortcuts (`e` = edit chapter) and links such as `?open=upload`.

| | Not logged in | Blocked | Reader | Editor | Admin |
|---|:-:|:-:|:-:|:-:|:-:|
| Read, search, highlights / notes in this browser | ✓ | ✓ | ✓ | ✓ | ✓ |
| Own highlights / bookmarks / notes synced across devices | | | ✓ | ✓ | ✓ |
| Edit verses and chapters, upload PDFs, restore original text | | | | ✓ | ✓ |
| Download data.js, backup (.json), book as HTML; restore a backup | | | | ✓ | ✓ |
| Delete chapters, reset all edits | | | | | ✓ |
| Administrator portal: users, roles, invites, activity, content, passkeys | | | | | ✓ |

- New accounts start as **Reader**. **Blocked** (role `none`, set by an admin) = signed in, but nothing more than a visitor.
- `sunilvalarian@gmail.com` is always **Admin** once its e-mail is verified (with any sign-in method). Change this in both `firestore.rules` and `app/js/firebase-config.js`.
- `haiabel43@gmail.com` is a **preset editor**: it starts as **Editor** (edit chapters, upload PDFs) on its first sign-in, once its e-mail is verified. After that an admin can change the role in the portal and the change sticks. The list is `APP_EDITORS` in `app/js/firebase-config.js` and `presetEditors()` in `firestore.rules`; keep the two the same.
- Edits by editors are saved to Firestore and show up live for everyone.

### Single sign-on login screen
☰ → **ലോഗിൻ** opens one login screen, shared by the reader and the administrator portal (`admin.html`). Both pages use the same Firebase session: signing in or out on one signs you in or out on the other. Sign-in methods:
- **Google**, **GitHub**, **Microsoft** (popup; a full-page redirect in the installed app or when popups are blocked).
- **E-mail link** (the blue ലോഗിൻ button): passwordless, Firebase e-mails a one-time link back to the page. Such accounts count as verified.
- **E-mail + password** (പാസ്‌വേഡ് ഉപയോഗിക്കുക), with പാസ്‌വേഡ് മറന്നോ? reset.
- **Passkey** (fingerprint / face / phone screen lock). Add one from ☰ → account card → *പാസ്‌കീ ചേർക്കുക* (or in the portal), then use *പാസ്‌കീ ഉപയോഗിച്ച് ലോഗിൻ*.

If an e-mail already has an account with another method (e.g. Google, then GitHub with the same address), the screen says which method to use; after signing in with it, the new method is linked to the same account automatically.

Hide a method by setting it to `false` in `window.AUTH_PROVIDERS` in `app/js/firebase-config.js`.

### Administrator portal
☰ → **അഡ്മിനിസ്ട്രേറ്റർ പോർട്ടൽ** (or open `/admin`). Admins only; others see an access-denied page. Sections: dashboard (counts + last activity), users (search, change role, block), invites, the role × permission table, activity log (filter by user / action), content (chapters edited online — revert one to the original text), passkeys (revoke), and login methods (what is switched on, and whether the passkey server answers).

An admin can invite an e-mail as Editor/Admin before the person signs up; the role applies once they sign in with that e-mail (verified). An admin can't change their own role or the owner's.

### Local mode (no Firebase)
Without a Firebase config the app runs in **local mode**, and edits stay in that browser:
- **Opened from disk or from `localhost`**: the owner can unlock editing and the data tools. ☰ → ലോഗിൻ → *ഈ കമ്പ്യൂട്ടറിൽ ഉടമയായി തുടരുക*: the first time, choose a passcode (at least 4 characters); later, enter it to unlock. It stays unlocked until the browser tab is closed, or until ☰ → *ലോക്ക് ചെയ്യുക*. The passcode is stored only as a PBKDF2-SHA256 hash in this browser. This keeps other people who use the computer out of the editing tools; it is **not** server security (anyone who can edit the browser's storage can get around it). Forgot it? Remove the `mlb.localOwner` entry from the site's localStorage (DevTools → Application) and set a new one. The admin portal in local mode shows only the chapters edited in this browser.
- **On a public web address**: read-only for everyone, and the login screen says that login hasn't been set up yet.

### One-time Firebase setup
1. Go to https://console.firebase.google.com and create a project (Google Analytics can be off).
2. **Build → Authentication → Get started**.
3. **Authentication → Settings → Authorized domains**: add the site domain, e.g. `malayalam-bible.pages.dev` (also needed for e-mail links).
4. **Build → Firestore Database → Create database**: *production mode*, location `asia-south1 (Mumbai)`.
5. **Firestore → Rules**: replace the contents with [`firestore.rules`](firestore.rules) and click **Publish**. Do this again whenever that file changes.
6. **Project settings (⚙) → General → Your apps → Web (`</>`)**: register an app, then copy the `firebaseConfig` object into `app/js/firebase-config.js` as `window.FIREBASE_CONFIG = { … }`. These values are not secret.
7. Turn on the sign-in methods (below), commit and push. Then open the site and sign in with the owner e-mail. You're Admin.

### Turning on each sign-in method
All in **Firebase → Authentication → Sign-in method → Add new provider**. The OAuth callback for GitHub and Microsoft is `https://<project-id>.firebaseapp.com/__/auth/handler` (Firebase shows it on the provider's page).
- **Google**: enable, choose a support e-mail, save.
- **E-mail link**: enable **Email/Password**, and inside it also enable **Email link (passwordless sign-in)**. (Email/Password alone gives the password option.)
- **GitHub**: at https://github.com/settings/developers → **OAuth Apps → New OAuth App**. Homepage URL = the site address; Authorization callback URL = the handler URL above. Register, then **Generate a new client secret**. In Firebase enable **GitHub** and paste the Client ID and Client secret.
- **Microsoft**: in the Azure portal (https://portal.azure.com) → **Microsoft Entra ID → App registrations → New registration**. Supported account types: *Accounts in any organizational directory and personal Microsoft accounts* (for `MICROSOFT_TENANT = 'common'`). Redirect URI: platform *Web*, the handler URL above. Then **Certificates & secrets → New client secret**. In Firebase enable **Microsoft** and paste the *Application (client) ID* and the secret **Value**. To allow only one organisation, set `window.MICROSOFT_TENANT` to its tenant ID (or `'organizations'` / `'consumers'`).
- **Passkey**: Firebase has no built-in passkeys, so a small Cloudflare Pages Function in [`functions/api/passkey/`](functions/api/passkey) checks them and signs the user in with a Firebase custom token.
  1. Firebase → **Project settings → Service accounts → Generate new private key** (downloads a JSON file; keep it secret, never commit it).
  2. Cloudflare → your Pages project → **Settings → Variables and Secrets → Add** (Production, type *Secret*):
     - `FIREBASE_SERVICE_ACCOUNT` = the whole contents of that JSON file;
     - `PASSKEY_SECRET` = a long random string (e.g. from a password generator).
  3. Redeploy (push, or *Deployments → Retry*). The portal's **ലോഗിൻ രീതികൾ** page shows whether `/api/passkey/challenge` works.
  4. Optional: in Firestore → **TTL policies**, add collection group `passkeyChallenges`, field `expireAt`, so used challenges are cleaned up automatically.

  Passkeys belong to the site's domain: a passkey made on `malayalam-bible.pages.dev` works only there.

### Testing locally with the Firebase emulator
```
firebase emulators:start --only auth,firestore --project demo-bible   # uses firebase.json + firestore.rules
# in a second terminal: serve app/ like Cloudflare Pages, including the passkey functions
FIREBASE_EMULATOR_HOST_FIRESTORE=127.0.0.1:8080 FIREBASE_PROJECT_ID=demo-bible node tools/dev-server.mjs
#   reader: http://localhost:8788/?emulator      portal: http://localhost:8788/admin.html?emulator
```
(On Windows PowerShell set the variables first: `$env:FIREBASE_EMULATOR_HOST_FIRESTORE='127.0.0.1:8080'; $env:FIREBASE_PROJECT_ID='demo-bible'`.) Use `localhost`, not `127.0.0.1`, for passkeys. Sign-in e-mails (links, verification) appear in the emulator log and at `http://127.0.0.1:9099/emulator/v1/projects/demo-bible/oobCodes`.

## Where changes are stored
In local mode, edits, uploads, highlights and notes are saved in the browser's localStorage, on this computer and in this browser only. In login mode, chapter edits live in Firestore and personal data syncs to the user's account. To keep a copy in the repository:
- ☰ → **data.js എക്സ്പോർട്ട്** (editors / local owner) downloads a new `data.js`. Replace `app/js/data.js` with it, and the edits become part of the app for everyone who opens it.
- ☰ → **ബാക്കപ്പ്** (editors / local owner) downloads a `.json` backup of everything (restore it from the same menu).

## Rebuilding the bundled text from the PDFs
```
node tools/build-data.js            # reads the PDFs in this folder → app/js/data.js
```
This prints a report per chapter (verses found, headings, missing verse numbers). Several source PDFs have missing verse numbers, e.g. ch 2 (10–22), ch 13 (2–5, 8–9), ch 16, ch 17. These come out in the text without a number; fix them with the editor.

## Notes on PDFs
The extractor (`app/js/pdf-extract.js`) reads the Unicode text that Google Docs / Chrome embed in the PDF (`ActualText`). Generic tools such as pdf.js scramble this Malayalam text. Scanned (image) PDFs and PDFs that use old ASCII Malayalam fonts (ML-TT etc.) have no usable text, and the upload dialog will say so.
