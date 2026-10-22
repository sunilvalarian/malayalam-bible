# Malayalam Bible reader

Open **`app/index.html`** in Chrome or Edge (double-click works, no server needed). Editing, uploads and the data tools need a login (or, without Firebase, the local owner passcode — see [Login and permissions](#login-and-permissions)).

## Features
- **Reading**: chapter title, section headings, superscript verse numbers. Swipe or use ← → (or the round buttons) to change chapter. The app remembers where you stopped.
- **Chapter / verse navigation**: tap the `ഉത്പത്തി 1 ▾` button. At the top, pick **പുസ്തകം / അധ്യായം / വാക്യം** together from three dropdowns and press പോകുക. Below that are Book → Chapter → Verse grids, or type a reference: `3`, `3:15`, `3 15`, `12:1-5`, `ഉത്പ 22:2`, `gen 3:15`.
- **Word search** (🔍 or `/`): finds partial words (`അനുഗ്രഹ`). Several words must all appear in the verse. Use `"quotes"` for an exact phrase. "Whole word" option. Search all books, this book, or this chapter.
- **Tap a verse**: highlight (5 colours), copy, share, bookmark, note, edit. Lists are under ☰ → My library.
- **Share** opens a sheet. WhatsApp, Telegram, X, e-mail and SMS (phones only) get the verse text plus a link to the verse in the app. The link can be switched off, and is not offered when the app is opened as a file. **Instagram** takes pictures only, so it gets the verses drawn on a card (1080 px wide: square, up to 9:16 for long passages), sent through the phone's share menu, or saved to post from the gallery. *ചിത്രം* saves the card. Facebook's sharer carries only the link, so the text is copied first, to paste there. *മറ്റുള്ളവ* is the phone's own share menu. The usage log records where each share went.
- **Aa**: font size, line spacing, 4 Malayalam fonts, Light / Sepia / Dark / Auto themes, paragraph or verse-per-line layout.
- **AI translation (Original | AI | താരതമ്യം)**: Claude's Malayalam translation from the Hebrew / Greek original, for Genesis 1–50, Matthew, Mark, Luke, John, Acts, Romans, 1–2 Corinthians and Galatians. It is not part of the normal view: for the people allowed to see it, ☰ → *AI പരിഭാഷകൾ* lists the translated chapters, and a tap opens one in the AI view. From then on a switch under the title of translated chapters chooses **Original** (the app's text), **AI** (the AI translation in place of the text; copy / share then copy the AI text) or **താരതമ്യം** (the original with the AI translation under each verse; words the original doesn't have are marked green); its **✕**, ☰ → *സാധാരണ വായന* (in the menu while the AI view is open) or a reload goes back to the normal view. It is **switched on per user** by an admin (portal → ഉപയോക്താക്കൾ → **AI** column; admins always have it) and applies live. Without Firebase (local mode) the unlocked owner has it. The translation is `app/js/ai-data.js` (about 2.8 MB, loaded the first time it is shown, offline after that), built by `node tools/build-ai-data.js tools/ai-translation` from one JSON file per chapter (see `tools/ai-translation/README.md`).
- **Editing**: ☰ → *ഈ അധ്യായം തിരുത്തുക* opens a side-by-side editor with live preview. Format: `[5]` starts verse 5, `## text` is a heading, each line is a paragraph. The editor warns about missing or out-of-order verse numbers. *യഥാർത്ഥം* restores the original PDF text.
- **Access codes and open editing**: an admin can hand out one-time codes that make someone an editor or admin, and can open PDF upload / chapter editing to everyone who is signed in (see [Login and permissions](#login-and-permissions)).
- **Works without internet**: after one visit online, the reader and the administrator portal open offline too (see [Offline](#offline)). An **ഓഫ്‌ലൈൻ** badge shows in the top bar while there's no connection.
- **Usage log**: everything people do in the app is recorded, also offline, and shown in the portal → **ഉപയോഗം** (see [Usage log](#usage-log)).
- **Word upload**: the same dialog (☰ → *PDF / Word അപ്‌ലോഡ് ചെയ്യുക*) also takes Microsoft Word **.docx** files. `app/js/docx-extract.js` reads them in the browser (no upload, no library): each Word paragraph is one paragraph, a Shift+Enter line break starts a new line (so verses typed one per line come out one per line), page breaks and deleted text of tracked changes are ignored, tables are read too. The text then goes through the same chapter / verse / heading detection, preview and save as a PDF. Type the chapter title like the PDFs (`ഉത്പത്തി 3` or `അധ്യായം 3`), or put the chapter number in the file name. Old Word 97–2003 **.doc** files can't be read: the dialog says to open them in Word and *Save As → Word Document (.docx)*. Text typed in old ASCII Malayalam fonts (ML-TT etc.) is refused like in PDFs; it has to be Unicode Malayalam.
- **PDF upload**: ☰ → *PDF / Word അപ്‌ലോഡ്*. Drop one or more PDFs. The book and chapter number are detected (from the file name or an `അധ്യായം N` header) and can be changed. Preview, then save. The chapter becomes part of the reader, and ☰ → *HTML ആയി ഡൗൺലോഡ്* exports a whole book as a single HTML file. Each detected chapter has a *ടെക്സ്റ്റ് തിരുത്തുക* button to fix the text (editor format) before saving.
- **Source documents**: ☰ → *ഉറവിട ഫയലുകൾ സൂക്ഷിക്കുക* keeps PDFs, Word files, text files and photos of printed pages **as they are** in this repository, by book (and chapter, if known), with an optional note. Nothing changes in the reader; the files are turned into text later (see [Source documents](#source-documents)). *ഫോട്ടോ എടുക്കുക* opens the phone camera, one page per photo. Same permission as PDF upload.
- **Camera scan**: ☰ → *ക്യാമറയിൽ സ്കാൻ ചെയ്യുക* (or the button in the upload dialog) opens the phone's camera. Take a photo of each page of a printed Bible. The photos are gathered into one scan (*അടുത്ത പേജ്* adds a page, ✕ on a thumbnail removes one). *ടെക്സ്റ്റ് ആക്കുക* reads them with OCR in the browser (`app/js/ocr.js`, [Tesseract.js](https://github.com/naptha/tesseract.js) with its Malayalam model). The text then goes through the same chapter / verse detection, preview and save as a PDF. OCR makes mistakes, so check the preview against the photo and fix the text before saving. Photos chosen through the upload dropzone are scanned the same way. Nothing leaves the device: the photos aren't uploaded, only the saved chapter text is. Same permission as PDF upload.
  - The first scan downloads the OCR library (about 4 MB) and the Malayalam model (about 3 MB) from cdn.jsdelivr.net. After that the service worker and the browser keep them, so scanning also works offline.
  - OCR needs a lot of memory, so it is freed again when the upload dialog closes.

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
| Edit verses and chapters | | | ✓* | ✓ | ✓ |
| Upload PDFs | | | ✓* | ✓ | ✓ |
| Restore original text (remove an edit) | | | | ✓ | ✓ |
| Download data.js, backup (.json), book as HTML; restore a backup | | | | ✓ | ✓ |
| Delete chapters, reset all edits | | | | | ✓ |
| AI translation in the reader (Original / AI / താരതമ്യം) | | | ✓† | ✓† | ✓ |
| Enter an access code (become Editor / Admin) | | | ✓ | ✓ | |
| Administrator portal: usage log, users, roles, invites, access codes, settings, activity, content, passkeys | | | | | ✓ |

\* only while an admin has ticked it in the portal → **ക്രമീകരണങ്ങൾ** (see [Open to everyone](#open-to-everyone-settings)).
† only for users an admin switched it on for (portal → **ഉപയോക്താക്കൾ** → **AI**: `users/{uid}.ai`, which only admins can change); each of them can hide it in Aa.

- New accounts start as **Reader**. **Blocked** (role `none`, set by an admin) = signed in, but nothing more than a visitor.
- `sunilvalarian@gmail.com` is always **Admin** once its e-mail is verified (with any sign-in method). Change this in both `firestore.rules` and `app/js/firebase-config.js`.
- `haiabel43@gmail.com` is a **preset editor**: it starts as **Editor** (edit chapters, upload PDFs) on its first sign-in, once its e-mail is verified. After that an admin can change the role in the portal and the change sticks. The list is `APP_EDITORS` in `app/js/firebase-config.js` and `presetEditors()` in `firestore.rules`; keep the two the same.
- Edits by editors are saved to Firestore and show up live for everyone.

### Single sign-on login screen
☰ → **ലോഗിൻ** opens one login screen, shared by the reader and the administrator portal (`admin.html`). Both pages use the same Firebase session: signing in or out on one signs you in or out on the other. Sign-in methods:
- **Google**, **GitHub**, **Microsoft** (popup; a full-page redirect in the installed app or when popups are blocked).
- **E-mail + password** (the default e-mail form): *രജിസ്റ്റർ ചെയ്യുക* creates the account and sends a verification e-mail; the invited / preset role applies once the link in it is opened (the app re-checks when you come back to the tab). പാസ്‌വേഡ് മറന്നോ? sends a reset link.
- **E-mail link** (*പാസ്‌വേഡ് ഇല്ലാതെ (ഇമെയിൽ ലിങ്ക്)*): passwordless, Firebase e-mails a one-time link back to the page. Such accounts count as verified. On the free plan Firebase sends only **5 sign-in links per day for the whole project**; after that the screen says so and switches to the password form.
- **Passkey** (fingerprint / face / phone screen lock). Add one from ☰ → account card → *പാസ്‌കീ ചേർക്കുക* (or in the portal), then use *പാസ്‌കീ ഉപയോഗിച്ച് ലോഗിൻ*.

If an e-mail already has an account with another method (e.g. Google, then GitHub with the same address), the screen says which method to use; after signing in with it, the new method is linked to the same account automatically.

Hide a method by setting it to `false` in `window.AUTH_PROVIDERS` in `app/js/firebase-config.js`.

### Administrator portal
☰ → **അഡ്മിനിസ്ട്രേറ്റർ പോർട്ടൽ** (or open `/admin`). Admins only; others see an access-denied page (where they can also enter an access code). Sections: dashboard (counts, today's app use, last activity), usage (everything done in the app, see [Usage log](#usage-log)), users (each with an **ഉപയോഗം** button for that person's full log) (search, change role, block), invites, access codes, the role × permission table, settings (open upload / editing to everyone), activity log (filter by user / action), content (chapters edited online — revert one to the original text), passkeys (revoke), and login methods (what is switched on, and whether the passkey server answers).

An admin can invite an e-mail as Editor/Admin before the person signs up; the role applies once they sign in with that e-mail (verified). An admin can't change their own role or the owner's. The **AI** column of the users page switches the AI translation in the reader on / off for that person (see *AI translation* under [Features](#features)).

The dashboard also shows how many access codes are still usable and what is open to everyone.

### Access codes
Invites need a verified e-mail, and on the free plan Firebase sends only 5 e-mail sign-in links a day, so people often sign up with a password and never get (or never open) the verification mail. An **access code** needs no verification:
1. Portal → **ആക്സസ് കോഡുകൾ**: pick the role (എഡിറ്റർ / അഡ്മിനിസ്ട്രേറ്റർ), how long it is valid (1 hour, 24 hours, 7 days, 30 days) and optionally who it is for, then **കോഡ് ഉണ്ടാക്കുക**. The code looks like `K7QM-4XPA` (8 random characters from `crypto.getRandomValues`, without the look-alikes 0 O 1 I L, ≈ 40 bits). Copy it, or press **WhatsApp-ൽ അയയ്ക്കുക** (a `wa.me` message with the code, a link `…/app/?code=K7QM-4XPA` and short Malayalam steps).
2. The person signs in with any method (a new password account is fine), then ☰ → account card → **കോഡ് നൽകുക** (also on the portal's access-denied page) and types the code — upper / lower case and the dash don't matter. Or they just open the link: the code is taken out of the address bar, the login screen opens if needed, and afterwards the dialog opens with the code filled in.
3. They get the role at once ("നിങ്ങൾ ഇപ്പോൾ എഡിറ്റർ / അഡ്മിൻ").

Each code works **once**, until it expires or an admin revokes it (റദ്ദാക്കുക). The list shows every code with its role, note, who made it and when, expiry and status (ഉപയോഗിക്കാത്തത് / ഉപയോഗിച്ചു — by whom and when / കാലഹരണപ്പെട്ടു / റദ്ദാക്കി). A code never lowers a role and isn't used up by someone who already has that role or a higher one ("ഇതിനകം ഈ റോൾ / ഉയർന്ന റോൾ ഉണ്ട്"); blocked users can't use codes. Anyone who has the code can use it, so send it only to the intended person. Creating, revoking and redeeming are in the activity log (only the last 4 characters of the code).

How the rules enforce it (no server code): codes are `accessCodes/{CODE}` (id = the code, upper case, no dash) with `role, note, createdBy, createdAt, expiresAt, used, usedBy, usedAt, revoked`. Only admins can create (fields checked, `createdBy` = their e-mail, server time, expiry in the future and at most 31 days), list and revoke (only `revoked` → true); nobody can delete a code or reset `used`. A signed-in user may read one code whose id they already know (to tell "used / expired / revoked" apart), but not list them. Redeeming is **one batched write**: `users/{uid}` gets `role` = the code's role and `redeemedCode` = the code (nothing else may change), and the code gets `used: true, usedBy: uid, usedAt: now`. The profile half is allowed only if, before the write, the code is unused, not revoked, not expired, grants exactly that role and it is a promotion from reader / editor — and, after the write (`getAfter`), the code is used by this user. The code half is allowed only if those three fields change as described, the user was a reader / editor below the code's role before, and after the write their profile has this `redeemedCode` and the code's role. So neither half works alone, a code can't be used twice (two people racing: the second write finds it used), and after an admin demotes someone their old `redeemedCode` is worthless (the code is already used). `redeemedCode` can't be set any other way (not on profile creation, not by an admin).

### Open to everyone (settings)
Portal → **ക്രമീകരണങ്ങൾ** has two tick boxes, saved immediately:
- **എല്ലാവർക്കും PDF അപ്‌ലോഡ്** (`settings/permissions.openUpload`): everyone who is signed in and not blocked can upload PDFs (add chapters, also new books, or overwrite existing ones).
- **എല്ലാവർക്കും അധ്യായം തിരുത്തൽ** (`settings/permissions.openEdit`): everyone who is signed in and not blocked can edit verses and chapters.

Visitors who aren't signed in stay read-only, and blocked users stay blocked. Restore original text, backups / data.js / HTML download stay Editor+; deleting / hiding chapters, reset all, users and the portal stay Admin. The change applies live in every open tab: the drawer items, the verse action bar's edit button, the `e` shortcut and `?open=upload|edit` follow it, and an editor / upload dialog that a reader has open closes when the tick is removed. Readers' edits are logged in the activity log like editors' and can be reverted from the portal's content page. `settings/permissions` (`openUpload, openEdit, updatedBy, updatedAt`) is readable by everyone and writable only by admins; each change is logged as "ക്രമീകരണം മാറ്റി".

In `firestore.rules` a chapter write by a non-editor is allowed only for an active (signed-in, not blocked) user with the usual chapter checks (`updatedBy` = their e-mail, server time, `hasBase` matches the bundled books, content not empty), never with `deleted: true`, and never on a chapter an admin has hidden. Firestore can't tell an upload from an edit, so: `openUpload` allows creating or overwriting any chapter; `openEdit` allows changing any existing visible chapter and creating the edited copy of a bundled chapter (but not a new, non-bundled one). Deleting a chapter document (remove an upload, or "restore original") stays Editor / Admin. When a reader edits a bundled chapter back to exactly its original text, the app stores that text instead of deleting the edit. Each such write costs one extra document read in the rules (the settings document).

### Offline
- The service worker (`app/sw.js`) caches the app, the Bible text, the fonts and the Firebase library on the first visit, and the OCR library the first time someone scans a page.
- Updates: the app opens from that cache at once and checks the server in the background (past the browser's HTTP cache, a cheap "not modified" answer when nothing changed). When a new `git push` changed the app or the Bible text (e.g. a new book in `data.js`), the reader asks *പുതിയ ഉള്ളടക്കം ലഭ്യമാണ്. ഇപ്പോൾ പുതുക്കണോ?*; പുതുക്കുക reloads with the new version (otherwise it shows on the next launch). It doesn't ask over an open dialog.
- Firestore's offline cache is switched on (`enablePersistence` in `cloud.js`). Chapters edited online, the admin switches, the user's profile, their synced highlights / notes and whatever the portal has loaded stay available offline.
- The saved sign-in is used offline, with the role this device last saw for that account.
- Offline, reading, search, highlights, bookmarks and notes work as usual. Chapter edits and uploads are queued by Firestore and sent when the connection is back (the rules check them then), and so are the activity-log entries.
- *Reset all* and anything that needs the server (sign-in, sending e-mails, access codes) still need a connection.
- The portal shows a banner while offline and reloads the page it's on when the connection is back.

### Usage log
`app/js/usage.js` records what is done in the app on each device. Every event is first saved in the browser (localStorage, at most 1500 waiting), so nothing is lost offline. When there is a connection, events go up to Firestore `usage/{batchId}`: one document per batch of at most 200 events. To stay inside the free plan, a batch goes up only when its oldest event is 15 minutes old, or 100 events have gathered (25 when the app is hidden), and always before signing out. A short visit therefore goes up at the start of the next one, so the portal shows new use a little late.

- **Recorded**:
  - app opened (reader / portal, installed app or browser, where the visitor came from)
  - each chapter read, with the seconds it was on screen
  - searches (words, number of results, scope)
  - copy, share, highlight, bookmark and note (which verses)
  - reading settings, menu items, chapter edits / uploads
  - login (method), logout, role changes
  - going online / offline, app installed, JavaScript errors, portal pages viewed
  - every event is marked online or offline
- **With each batch**:
  - the account (checked by the rules), or none for a visitor who isn't signed in
  - a random device id
  - the device: OS and version, browser, model, screen, language, time zone, installed app or not
  - the approximate place (city, region, country, IP, ISP). It comes from the Cloudflare Pages Function `/api/where` (`functions/api/where.js`, no secrets needed) and is refreshed once a day. It's empty on hosts without the function.
- **Portal → ഉപയോഗം**:
  - period: today, 7, 30 or 90 days
  - filters: everyone, signed-in, visitors, one person or device; event type; free-text search
  - totals: people, sessions, chapters read and reading time, searches, what was done offline, errors
  - a table per person / device (device, place, sessions, reading, searches, offline use, last seen)
  - day by day, the most-read chapters, the words searched for (0 results are marked)
  - the full timeline
  - click a person for their details (all devices, IP, browser string, first / last seen)
  - **CSV** downloads what is shown
  - old batches can be deleted (older than 30 / 90 / 180 / 365 days); this is recorded in the activity log
- **Rules**: anyone, also someone not signed in, may *create* a batch in the checked format; nobody can change one; only admins can read or delete them.
- **Free plan**: each batch is 1 write, and the portal reads 1 document per batch (500 per page, then *കൂടുതൽ ലോഡ് ചെയ്യുക*). The free plan allows 20 000 writes and 50 000 reads a day.
- **Telling users**: the reading settings (**Aa**) have a line saying that usage is recorded.
- **Updating the app**: bump `APP_VERSION` in `usage.js` together with `VERSION` in `sw.js`.

### Free plan, battery and memory
The project runs on Firebase's free Spark plan (per day: 50 000 reads, 20 000 writes, 20 000 deletes; 1 GiB stored). What keeps it inside those limits:
- **Usage log**: events are gathered into batches (above), 1 write per batch.
- **Profile**: a restored session reads the invite list once per browser session, not on every page load. It writes the profile only when something changed, or every 12 hours to refresh the last-login time.
- **Personal sync**: several highlights / bookmarks / notes in a row go up as one write (3 seconds after the last one, or at once when the app is hidden).
- **Portal**: the user list is reused for 2 minutes across pages, and the usage batches for 5 minutes. A shorter period, or the dashboard's "today", is worked out from what is already loaded, without new reads. **പുതുക്കുക** reads afresh.
- **Offline cache**: Firestore's offline cache also saves reads, because listeners resume from it.
- **Old usage logs**: delete them from the portal to keep the storage small.

Battery and memory:
- No timers run in the background. The usage log sets one timer, only while the app is visible, for when the next batch is due.
- A page hidden for 2 minutes closes its live Firestore connection, and reconnects when shown again. This saves the phone's radio.
- The waiting usage events are kept parsed in memory: storage is only written, never re-read, for each event.
- Scrolling only touches the top bar when it crosses the line, and saves the reading position once scrolling stops.
- The search index and the word list are built only when first needed.

### Local mode (no Firebase)
Without a Firebase config the app runs in **local mode**, and edits stay in that browser:
- **Opened from disk or from `localhost`**: the owner can unlock editing and the data tools. ☰ → ലോഗിൻ → *ഈ കമ്പ്യൂട്ടറിൽ ഉടമയായി തുടരുക*: the first time, choose a passcode (at least 4 characters); later, enter it to unlock. It stays unlocked until the browser tab is closed, or until ☰ → *ലോക്ക് ചെയ്യുക*. The passcode is stored only as a PBKDF2-SHA256 hash in this browser. This keeps other people who use the computer out of the editing tools; it is **not** server security (anyone who can edit the browser's storage can get around it). Forgot it? Remove the `mlb.localOwner` entry from the site's localStorage (DevTools → Application) and set a new one. The admin portal in local mode shows only the chapters edited in this browser.
- **On a public web address**: read-only for everyone, and the login screen says that login hasn't been set up yet.

### One-time Firebase setup
Already done for this site: Firebase project **`malayalam-bible-app`** (owner sunilvalarian@gmail.com), Firestore in `asia-south1` with `firestore.rules` deployed, web app config in `app/js/firebase-config.js`. To redeploy the rules after changing them: `firebase deploy --only firestore:rules` (the project is set in `.firebaserc`). Sign-in providers are also set up from this repo: the `auth` block in `firebase.json` (Email/Password + Google), applied with `firebase deploy --only auth`; no billing needed. E-mail link and the authorized domains (`sunilvalarian.github.io`, `localhost`) are already on. The project runs on the free Spark plan, so Firebase's daily free limits apply ([limits](https://firebase.google.com/docs/auth/limits)): e-mail sign-in links **5/day** (project-wide), verification e-mails 1000/day, password-reset e-mails 150/day. That's why the login screen puts e-mail + password first. Firebase's e-mails come from `noreply@malayalam-bible-app.firebaseapp.com` (sender name "Malayalam Bible") and often land in Spam / Promotions; the screen tells users to look there. Request logging (Cloud Logging of sign-in calls) needs billing, so it's off. Optional, still free: in Authentication → Templates → SMTP settings, send through your own mailbox (e.g. a Gmail app password or a free SMTP service) for better delivery (the 5/day e-mail-link limit may still apply).

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

### Automated tests
The tests live in [`tests/`](tests) with their own `package.json`, so the site and the Cloudflare deploy don't depend on npm. They need Node 20+, and Java for the Firebase emulator (`JAVA_HOME` or `java` on the PATH). The end-to-end tests also need Google Chrome.
```
cd tests
npm install
npm test              # everything
npm run test:unit     # usage log, /api/where, parser (no emulator)
npm run test:rules    # firestore.rules against the Firestore emulator (own ports: 8180 …)
npm run test:e2e      # Chrome + emulators + dev server: offline start, usage upload, portal
```

## Where changes are stored
In local mode, edits, uploads, highlights and notes are saved in the browser's localStorage, on this computer and in this browser only. In login mode, chapter edits live in Firestore and personal data syncs to the user's account. To keep a copy in the repository:
- ☰ → **data.js എക്സ്പോർട്ട്** (editors / local owner) downloads a new `data.js`. Replace `app/js/data.js` with it, and the edits become part of the app for everyone who opens it.
- ☰ → **ബാക്കപ്പ്** (editors / local owner) downloads a `.json` backup of everything (restore it from the same menu).

## Rebuilding the bundled text from the PDFs
```
node tools/build-data.js            # reads the PDFs in this folder → app/js/data.js
```
This prints a report per chapter (verses found, headings, missing verse numbers). Several source PDFs have missing verse numbers, e.g. ch 2 (10–22), ch 13 (2–5, 8–9), ch 16, ch 17. These come out in the text without a number; fix them with the editor.

Chapters typed from a photo of the printed Bible (no PDF) are kept in `tools/sources/<BOOK ID>/<chapter>.txt`, in the editor format (`## heading`, `[5]` starts verse 5, one line per paragraph). The same command adds them to `data.js` as their own books. Exodus (`tools/sources/EXO/1.txt` … `40.txt`) is typed in full: 1–3:5 first, then 3:5 to the end of the book from photos of pages 68–116 (one photo per page). Every verse is there: 1:22, 2:25, 3:22, 4:31, 5:23, 6:30, 7:29, 8:28, 9:35, 10:29, 11:10, 12:51, 13:22, 14:31, 15:27, 16:36, 17:16, 18:27, 19:25, 20:26, 21:37, 22:30, 23:33, 24:18, 25:40, 26:37, 27:21, 28:43, 29:46, 30:38, 31:18, 32:35, 33:23, 34:35, 35:35, 36:38, 37:29, 38:31, 39:43, 40:38 (1213 verses). The verse numbering follows the print, which uses the Hebrew division: the frog plague is 7:26–29 (8:1–4 in many Bibles) and 21:37 is 22:1 elsewhere. The songs in 15, 17:16 and 32:18 are one line per verse, with the poetry on unnumbered lines after the verse's opening words.

Leviticus (`tools/sources/LEV/1.txt` … `27.txt`) is typed in full from photos of pages 119–155 (one photo per page). Every verse is there: 1:17, 2:16, 3:17, 4:35, 5:26, 6:23, 7:38, 8:36, 9:24, 10:20, 11:47, 12:8, 13:59, 14:57, 15:33, 16:34, 17:16, 18:30, 19:37, 20:27, 21:24, 22:33, 23:44, 24:23, 25:55, 26:46, 27:34 (859 verses). The numbering again follows the Hebrew division: 5:20–26 is 6:1–7 in many Bibles, so chapter 6 starts at what is elsewhere 6:8. Chapter 26 has no heading of its own; the print puts ഇസ്രായേല്യർ കർത്തൃദാസർ above 25:55. Readings from the print: 22:12 is printed with the verse number "2"; 14:25 prints the broken form കാലിൻെറ (typed as കാലിന്റെ); 1:16 കണ്ഠസഞ്ചി is printed with a chillu (കൺഠ). Spacing was kept as printed, for example 9:23 മോശയുംഅഹറോനും, 14:18 ഉള്ളംകൈയിലുള്ളഎണ്ണയിൽ and 24:6 തങ്കമേശമേൽസ്ഥാപിക്കണം. 17:1 ends with a comma (ഇപ്രകാരം വചിച്ചു,) as printed.

Numbers (`tools/sources/NUM/1.txt` … `36.txt`) is typed in full from photos of pages 158–207 (one photo per page; the photo of page 204 has the page number cut off). Every verse is there: 1:54, 2:34, 3:51, 4:49, 5:31, 6:27, 7:89, 8:26, 9:23, 10:36, 11:35, 12:16, 13:33, 14:45, 15:41, 16:35, 17:28, 18:32, 19:22, 20:29, 21:35, 22:41, 23:30, 24:25, 25:19, 26:65, 27:23, 28:31, 29:39, 30:17, 31:54, 32:42, 33:56, 34:29, 35:34, 36:13 (1289 verses). The numbering follows the Hebrew division: 16:36–50 of many Bibles is 17:1–15 here, 25:19 is the first half of 26:1 elsewhere, and 29:40 is 30:1. The heading before 19:11 is printed in the middle of verse 10. Spellings kept as printed, for example 3:24 എലിഫാസ, 7:24 ബേലോന്റെ (7:29 ഹേലോന്റെ), 26:21 ഹെസ്രോൺ, 27:4 കുടുബത്തിനിടയിൽനിന്ന്, 29:34 മുട്ടനാടും, 35:18 കൊലപാതമാണ്; in 7:83 the verse number stands before അഞ്ചു മുട്ടാടുകൾ, not before സമാധാനബലിക്കുള്ള as in the other offerings.

Deuteronomy (`tools/sources/DEU/1.txt` … `34.txt`) is typed in full from photos of pages 209–257 (one photo per page; the photo of page 209 shows only its lower half, 1:1–7, without the page number). Every verse is there: 1:46, 2:37, 3:29, 4:49, 5:33, 6:25, 7:26, 8:20, 9:29, 10:22, 11:32, 12:31, 13:19, 14:29, 15:23, 16:22, 17:20, 18:22, 19:21, 20:20, 21:23, 22:29, 23:26, 24:22, 25:19, 26:19, 27:26, 28:69, 29:28, 30:20, 31:30, 32:52, 33:29, 34:12 (959 verses). Again the Hebrew division: 12:32 elsewhere is 13:1 here, 22:30 is 23:1 and 29:1 is 28:69. The songs in 32 and 33 are one printed line per line of text. Kept as printed: 5:26 സജീവദൈവത്തിന്റ, 6:22 ബ്രഹത്തും, 23:8 ഈജിപതുകാരനെ, 30:18 ദീർഘിക്കാൻ നിങ്ങളിടയാക്കും, and the opening quote marks with no closing quote in 7:17, 9:23, 18:21, 22:14 and 22:17.

Worth checking against the book (Numbers and Deuteronomy): this print breaks words at line ends without a hyphen, so where a line ends between two words it is not always clear whether there is a space. These were typed as one word: NUM 2:8 അമ്പത്തേഴായിരത്തിനാനൂറ്, 2:24 ഒരുന്നൂറ്, 11:24 പുറത്തുചെന്ന്, 11:32 ദിവസംമുഴുവനും, 27:11 ന്യായപ്രമാണചട്ടമായിരിക്കും, 31:52 കാണിക്കസ്വർണം; DEU 2:8 ലക്ഷ്യംവച്ചു, 5:10 പാലിക്കുന്നവർക്കുംവേണ്ടി, 33:3 പരിലാളിക്കുന്നവൻതന്നെ, 33:12 ചൂഴ്ന്നുനില്ക്കുന്നു. Blurred or faint spots: NUM 4:40 and 4:44 (…നൂറ്…), 32:41 ഹവ്വോത്തേഹെം, 31:8 റെഖെം; DEU 1:8 നോക്കൂ, 3:14 ഗഷുറുകാരുടെയും, 16:11 and 16:14 ലേവ്യനും, and DEU 18:4–16, where the right edge of the column is cut off in the photo.

Exodus corrections: missing spaces in 21:6 (കൊണ്ട് തുളയ്ക്കണം), 33:20 (തുടർന്ന് അവിടന്നു) and 38:9 (പിരിച്ച ചണംകൊണ്ടുള്ളത്), missing closing quotes in 19:12, 32:24 and 33:5, and missing full stops in 36:32 and 38:1. Odd spellings were kept as printed, for example 16:32 സൂക്ഷത്തിനായി, 6:19 ലേവായകുടുംബങ്ങൾ, 28:3 ജ്ഞാനാരൂപി, ചട്ടടുപ്പ് (27:4, 38:4–5), 35:27 ഉരസ്ത്രാണിനും, and 18:2 "അവർ പറഞ്ഞയച്ചതിനെത്തുടർന്ന്" (അവൻ would fit better).

Worth checking against the book:
- Blurred spots: 6:14–15 (the names), 7:9 (തരൂ), 14:6–10, 19:5 (എന്റേതാണെങ്കിലും), 27:4, 36:16–19, 38:26 (…മൂവായിരത്തി…) and 39:43.
- Words split at a line end, where the print does not show whether there is a space: these were joined or spaced to match how the print writes them elsewhere.

The photos are not in the repository.

Other books' chapter PDFs go in the same folder, with the chapter number in the file name (`tools/sources/MAT/അധ്യായം 5.pdf`); their fixes are under the book id in `tools/text-fixes.js`. Matthew 1–16 come from the PDFs (not in them, so missing in the text: 11:23–24 and 14:7). Matthew 17–28 were typed from photos of the printed Bible (pages 24–42), as `17.txt` … `28.txt`: the PDF of chapter 17 was a blank page and the one of chapter 18 stopped at verse 23. Cross-references and footnotes of the print are left out.

Mark (`tools/sources/MRK/1.txt` … `16.txt`) was typed in full from photos of the printed Bible (pages 44–69, one photo per page), with all 678 verses (1:45, 2:28, 3:35, 4:41, 5:43, 6:56, 7:37, 8:38, 9:50, 10:52, 11:33, 12:44, 13:37, 14:72, 15:47, 16:20). The verse numbering follows the print, e.g. 7:16, 9:44, 9:46 and 11:26 are there. The photo of page 60 (11:4–29) is blurred and was read zoomed in, so check those verses against the book. The photos are not in the repository.

Luke (`tools/sources/LUK/1.txt` … `24.txt`) was typed in full from photos of the printed Bible (pages 71–112, one photo per page; some photos have no page number visible): 1:80, 2:52, 3:38, 4:44, 5:39, 6:49, 7:50, 8:56, 9:62, 10:42, 11:54, 12:59, 13:35, 14:35, 15:32, 16:31, 17:37, 18:43, 19:48, 20:47, 21:38, 22:71, 23:56, 24:53. The verse numbering follows the print: 2:30–31 is printed as one verse and stored as verse 30, and 17:36 and 23:17 are not in the print (only a footnote), so the build report lists these three as missing. Blurred spots that were read but are worth checking against the book: 1:1–3, 4:18–25, 12:3 (പുരമുകളിൽ), 14:16–20, 23:13–32. The photos are not in the repository.

Acts (`tools/sources/ACT/1.txt` … `28.txt`) was typed in full from photos of the printed Bible (pages 147–185, one photo per page): 1:26, 2:47, 3:26, 4:37, 5:42, 6:15, 7:60, 8:40, 9:43, 10:48, 11:30, 12:25, 13:52, 14:28, 15:41, 16:40, 17:34, 18:28, 19:41, 20:38, 21:40, 22:30, 23:35, 24:27, 25:27, 26:32, 27:44, 28:31. The verse numbering follows the print, so the build report lists these as missing: 1:2, 1:25 and 2:35 (printed together with the verse before, stored under its number) and 8:37, 15:34, 24:7 and 28:29 (not in the print, only a footnote). Blurred spots that were read but are worth checking against the book: 13:4–11, 20:4, 20:14 (മിത്ത്യുലേനെ), 26:32–27:3. The photos are not in the repository.

Romans, 1 Corinthians and 2 Corinthians (`tools/sources/ROM`, `1CO`, `2CO`) were typed in full from photos of the printed Bible (pages 190–205, 207–222 and 224–234, one photo per page; page 222, 1 Corinthians 16:9–24, came later as a separate photo). Romans has 16 chapters (16:24 is not in the print, only a footnote, so it shows as missing), 1 Corinthians 16 chapters, and 2 Corinthians 13 (chapter 13 ends at verse 13 as printed). Blurred spots that were read but are worth checking against the book: Romans 8:20–22 and 8:34–36, 1 Corinthians 7:2 (top of page 212), 2 Corinthians 11:26–31 and 13:9–10. The photos are not in the repository.

Galatians (`tools/sources/GAL/1.txt` … `6.txt`) was typed in full from photos of the printed Bible (pages 236–241, one photo per page), with all 149 verses (1:24, 2:21, 3:29, 4:31, 5:26, 6:18). Worth checking against the book: 2:21 (വൃഥാ). The photos are not in the repository.

Ephesians, Philippians and Colossians (`tools/sources/EPH/1.txt` … `6.txt`, `PHP/1.txt` … `4.txt`, `COL/1.txt` … `4.txt`) were typed in full from photos of the printed Bible (pages 243–248, 250–253 and 255–259, one photo per page), with every verse (Ephesians 1:23, 2:22, 3:21, 4:32, 5:33, 6:24; Philippians 1:30, 2:30, 3:21, 4:23; Colossians 1:29, 2:23, 3:25, 4:18). Blurred spots that were read but are worth checking against the book: Ephesians 3:17 (the punctuation after വസിക്കട്ടെ), 4:3 (ബദ്ധതയിൽ) and 5:25–31; Colossians 3:1–14. The photos are not in the repository.

The remaining letters and Hebrews were typed in full the same way, one photo per page, with every verse:

| Book | Source files | Pages |
|---|---|---|
| 1 and 2 Thessalonians | `tools/sources/1TH`, `2TH` | 261–264, 266–267 |
| 1 and 2 Timothy | `1TI`, `2TI` | 270–274, 275–278 |
| Titus and Philemon | `TIT`, `PHM` | 279–281, 283 |
| Hebrews | `HEB` | 285–296 |
| James | `JAS` | 299–302 |
| 1 and 2 Peter | `1PE`, `2PE` | 304–308, 310–312 |

Three obvious misprints were corrected: 1 Timothy 3:11 പരദുഷണം → പരദൂഷണം, Hebrews 7:10 അബാഹത്തെ → അബ്രാഹത്തെ and 2 Peter 1:3 ഭക്തക്കും → ഭക്തിക്കും. Other odd spellings were kept as printed, for example 2 Timothy 2:21 വിശുദ്ധീകരിക്കപ്പെടേണ്ടതും and 1 Timothy 2:5 ഉള്ളു (for ഉള്ളൂ).

Worth checking against the book:
- Philemon 13 ബന്ധിതാവസ്ഥയിൽ: only the top half of that line is in the photo.
- Blurred spots: Hebrews 7:20–25 and 11:16 (അവിടന്ന്), James 3:4–6 and 4:1–2, Titus 1:12 (ക്രേത്ത്യർ) and 2 Timothy 4:19 (അക്വീലായ്ക്കും).

The photos are not in the repository.

John, the letters of John, Jude and Revelation were typed in full the same way, which completes the New Testament:

| Book | Source files | Pages |
|---|---|---|
| John | `tools/sources/JHN` | 114–145 |
| 1, 2 and 3 John | `1JN`, `2JN`, `3JN` | 314–318, and one photo each for 2 and 3 John |
| Jude | `JUD` | 322–323 |
| Revelation | `REV` | 325–342 |

Every verse is there, except John 5:4, which is not in the print (the numbers go from 3 to 5), so the build report lists it as missing. John 7:53 is printed and included. Where the print places a verse number differently from the usual division, the print was followed: John 2:2, 4:5 (the number stands before യാക്കോബ്), 19:2 and 20:4. Headings keep no parallel references (Jude's "2 പത്രോ 2,1-17" is left out).

Obvious misprints corrected: 1 John 2 heading നമ്മുടെമധ്യസ്ഥൻ → നമ്മുടെ മധ്യസ്ഥൻ, John 12:36 പറഞ്ഞശഷം → പറഞ്ഞശേഷം, and missing spaces in John 9:17 (നീഎന്തു) and 12:8 (ദരിദ്രർഎപ്പോഴും).

Worth checking against the book:
- Revelation 20:10 "അവിടെ അവർ രാപകൽ…": അവർ or അവൻ is not clear in the photo.
- Revelation 2:12 ends with a comma (പറയുന്നു,) where the other letters have a colon; typed as printed.
- John 8:57 (കണ്ടെന്നോ?, blurred), 9:13–21 (blurred photo), 12:4 (സ്കറിയോത്താ), 12:33 and 21:19 (സൂചിപ്പിക്കാനാണ്).

The photos are not in the repository.

1 Samuel (`tools/sources/1SA/1.txt` … `31.txt`) is typed in full from photos of pages 327–368 (one photo per page; the photo of page 327 shows only the lower part, without the page number). Every verse is there: 1:28, 2:36, 3:21, 4:22, 5:12, 6:21, 7:17, 8:22, 9:27, 10:27, 11:15, 12:25, 13:23, 14:52, 15:35, 16:23, 17:58, 18:30, 19:24, 20:42, 21:16, 22:23, 23:28, 24:23, 25:44, 26:25, 27:12, 28:25, 29:11, 30:31, 31:13 (810 verses). The numbering follows the Hebrew division: the second half of 20:42 in many Bibles is 21:1 here, and 23:29 is 24:1 here. Hannah's song (2:1–10) is one line per verse; 15:22–23 and 16:12 have an unnumbered line where the print starts a new paragraph inside the verse. Kept as printed: 2:8 ധൂളിയിൽനിന്ന്എഴുന്നേല്പിക്കുന്നവൻ, 3:16 ending "ഇതാ, ഞാൻ" with no punctuation, 4:3 ഉടമ്പടിപ്പേടകം but 4:4–5 ഉടമ്പടിപേടകം, 15:5 വാഗ്വാദത്തിലേർപ്പെട്ടു, 16:1 ബേത്ലെഹംകാരനായ, 23:27 യാത്രയാകു, 24:1 എൻഗേദി but 24:2 ഏൻഗേദി.

Worth checking against the book (1 Samuel):
- 17:28–30, at the top of page 350, is out of focus: 17:29 "ഇത് ഒരു പ്രധാനകാര്യമല്ലേ?" was read from the letter shapes.
- Page 348 is soft at the top: 16:9 ഷമ്മായെയാണ്, 16:20 ഒരു ഓമർ അപ്പം.
- 21:8: the verse number is only a faint mark in a low-resolution photo (page 356).
- Words split across a page break were joined without a space where the print splits a word (3:1 അക്കാലത്ത്, 9:24, 13:3 സൈനികാസ്ഥാനം, 15:6, 20:41, 26:1, 26:20, 28:2, 30:23).

Joshua came with many pages missing, so only whole chapters are in the app. Joshua 1, 2, 7, 16, 17, 20 and 21 are complete (pages 259–261, 264–266, 276–278, 281–284), and Joshua 3 lacks only verse 17 (page 262 is missing). The typed parts of other chapters are kept in `tools/sources/JOS/partial/` (build-data ignores it; `…` marks where a page is missing), ready to be completed when the missing pages come: pages 262–263, 267–268, 270–272, 274–275, 279–280 and 285–286 are missing. So chapters 4, 5, 11, 14 and 23 are missing entirely. The partial ones are 6 (from 6:5), 8 (to 8:10), 9–10 (9:18–10:11), 12–13 (12:4–13:14), 15 (from 15:9), 18 (to 18:10), 19 (from 19:48), 22 (to 22:27) and 24 (from 24:8). Ruth: no photos yet.

Judges (`tools/sources/JDG/1.txt` … `21.txt`) is typed in full from photos of pages 290–320 (the photo of page 290 has the page number cut off; pages 299, 308 and 316–317 were typed twice, from both batches, and the two readings agree). Every verse is there: 1:36, 2:23, 3:31, 4:24, 5:31, 6:40, 7:25, 8:35, 9:57, 10:18, 11:40, 12:15, 13:25, 14:20, 15:20, 16:31, 17:13, 18:31, 19:30, 20:48, 21:25 (618 verses). The poems (Deborah's song 5:2–31, Jotham's fable 9:7–20, the riddles 14:14 and 14:18, Samson's songs 15:16 and 16:23–24) are one line per verse; 6:22 and 7:5 have an unnumbered line where the print starts a new paragraph inside the verse. Kept as printed: ദബോറാ / ദെബോറാ, ഹറോഷെത്ത് (4:2) / ഹറോഷേത്ത് (4:13), 6:11 ഒഫ്രായിൽ but 6:24 ഓഫ്രായിൽ, 10:6 മൊവാബ്, 11:32 ഏല്പ്പിക്കുകയും, 14:4 മാതാപിതാന്മാർ, 15:5 മുളമുതൽ, 16:22 മുളക്കാൻ, 16:24 നിഹിതരെ and 20:31 നിഹിതരായി, 20:10 ഗിബയാ, 20:15 എഴുനൂറുപേർ next to 20:16 എഴുന്നൂറ്.

Worth checking against the book (Judges):
- 8:32: the verse number covers the first letter; read as യോവാഷിന്റെ (as in 8:29), the print may show യാവാഷിന്റെ.
- 15:19 ഏൻ-ഹക്കോറേ (old-style ോ around ക്ക), 16:20 ഏഴുന്നേറ്റുപോകും (with ഏ), 9:29 the mark after പറഞ്ഞു (typed as a comma).
- Where a line break falls between two words the print does not show the space; joined: 3:1 പരീക്ഷിക്കാൻവേണ്ടി, 3:3 ബാൽഹെർമോൻമല, 7:22 അബൽമെഹോലവരെയും, 9:16 പ്രവൃത്തിഫലംപോലെ; kept apart: 7:5 മാറ്റി നിർത്തണം, 8:26 ആയിരത്തി എഴുന്നൂറു, 12:11 പത്തു വർഷം, 12:14 എട്ടു വർഷം.

Worth checking against the book (Joshua): 16:5 അഥ്റോത്ത് (could be അത്റോത്ത്); kept as printed: 2:22 കണ്ടത്താനായില്ല, 7:4 മൂവായിരിത്തോളംപേർ, 7:15 ഇസ്രയേലിൽ, 17:2 അബിയേര്യർ, and 21:9 ending with no full stop. Names printed with a visible chandrakkala keep a zero-width non-joiner (ആയ്‌, യാർമുത്‌രാജാവ്, ലാകീഷ്‌രാജാവ്).

The photos are not in the repository.

2 Samuel, 1 and 2 Kings, 1 and 2 Chronicles, Ezra and Nehemiah were typed in full the same way, one photo per page, with every page there:

| Book | Source files | Pages | Last verses | Verses |
|---|---|---|---|---|
| 2 Samuel | `tools/sources/2SA` | 369–403 | 1:27, 2:32, 3:39, 4:12, 5:25, 6:23, 7:29, 8:18, 9:13, 10:19, 11:27, 12:31, 13:39, 14:33, 15:37, 16:23, 17:29, 18:32, 19:44, 20:26, 21:22, 22:51, 23:39, 24:25 | 695 |
| 1 Kings | `1KI` | 405–444 | 1:53, 2:46, 3:28, 4:20, 5:32, 6:38, 7:51, 8:66, 9:28, 10:29, 11:43, 12:33, 13:34, 14:31, 15:34, 16:34, 17:24, 18:46, 19:21, 20:43, 21:29, 22:54 | 817 |
| 2 Kings | `2KI` | 445–481 | 1:18, 2:25, 3:27, 4:44, 5:27, 6:33, 7:20, 8:29, 9:37, 10:36, 11:20, 12:22, 13:25, 14:29, 15:38, 16:20, 17:41, 18:37, 19:37, 20:21, 21:26, 22:20, 23:37, 24:20, 25:30 | 719 |
| 1 Chronicles | `1CH` | 483–518 | 1:54, 2:55, 3:24, 4:43, 5:41, 6:66, 7:40, 8:40, 9:44, 10:14, 11:47, 12:41, 13:14, 14:17, 15:29, 16:43, 17:27, 18:17, 19:19, 20:8, 21:30, 22:19, 23:32, 24:31, 25:31, 26:32, 27:34, 28:21, 29:30 | 943 |
| 2 Chronicles | `2CH` | 519–561 | 1:18, 2:17, 3:17, 4:22, 5:14, 6:42, 7:22, 8:18, 9:31, 10:19, 11:23, 12:16, 13:23, 14:14, 15:19, 16:14, 17:19, 18:34, 19:11, 20:37, 21:20, 22:12, 23:21, 24:27, 25:28, 26:23, 27:9, 28:27, 29:36, 30:27, 31:21, 32:33, 33:25, 34:33, 35:27, 36:23 | 822 |
| Ezra | `EZR` | 563–574 | 1:11, 2:70, 3:13, 4:24, 5:17, 6:22, 7:28, 8:36, 9:15, 10:44 | 280 |
| Nehemiah | `NEH` | 576–593 | 1:11, 2:20, 3:38, 4:17, 5:19, 6:19, 7:72, 8:18, 9:37, 10:40, 11:36, 12:47, 13:31 | 405 |

The numbering follows the print's Hebrew division: 2 Samuel 18:33 elsewhere is 19:1 here; 1 Kings 4:21–34 is 5:1–14 and 5:1–18 is 5:15–32, and 22:43 is split (22:44 begins എങ്കിലും പൂജാഗിരികൾ); 2 Kings 11:21 is 12:1; 1 Chronicles 6:1–15 is 5:27–41 and 6:16–81 is 6:1–66, and 12:4 is split into 12:4–5; 2 Chronicles 2:1 is 1:18 and 14:1 is 13:23; Nehemiah 4:1–6 is 3:33–38 and 9:38 is 10:1, and 7:73 is 7:72 plus an unnumbered paragraph. The poems (2 Samuel 1:19–27, 3:33–34, 12:1–4, 22, 23:1–7; 2 Kings 19:21–28; 1 Chronicles 16:8–36; Nehemiah 9:5 onwards) and the printed name lists are one line per verse. Headings keep no parallel references.

Obvious misprints corrected: 2 Samuel 14:19 യജമാനായ → യജമാനനായ; 1 Kings 1:20 ഇസ്രായലിന്റെ → ഇസ്രായേലിന്റെ, 2:20 തിരസ്കരിക്കുകുകയില്ല → തിരസ്കരിക്കുകയില്ല; 2 Kings 15:6 ചെയ്തതൊക്കയും → ചെയ്തതൊക്കെയും, 20:3 വിശ്വസ്തയിലും → വിശ്വസ്തതയിലും, 23:4 കാവൽല്ക്കാരോടും → കാവല്ക്കാരോടും, 23:16 a gap inside പ്രഖ്യാപിച്ചിരുന്ന; 1 Chronicles 10:6 മൃന്നു → മൂന്നു, 12:12 എഴാമൻ → ഏഴാമൻ, 19:8 ദാവിദ് → ദാവീദ്, 27:8 ഇരൂപത്തിനാലായിരം → ഇരുപത്തിനാലായിരം; Ezra 2:26 അറന്നൂറ്റി… → അറുന്നൂറ്റിയിരുപത്തൊന്ന്, 6:7 ദേവലായനിർമാണത്തിൽ → ദേവാലയനിർമാണത്തിൽ, and a stray second "42" before the names in 10:43. Kept as printed, though they look like misprints: 1 Kings 21:22 നാബോത്തിന്റെ പുത്രൻ ജറോബോവാം (elsewhere നെബാത്തിന്റെ), 16:20 ദിനവൃത്താന്തപുസ്തത്തിൽ, 11:42 ഇസ്രായേൽമുഴുന്റെയുംമേൽ, 2 Kings 2:10 ദുഷ്കരയതാണ്, 3:7 മൊബാവിലേക്ക്, 2 Chronicles 1:12 ഉണ്ടാവുകയില്ലയില്ലാത്തതുമായ, 36:16 ശമിപ്പിക്കാനാവത്തവിധം, 1 Chronicles 25:3 (five names, "ആറുപേർ"). 2 Chronicles 36:11 gives Zedekiah's age as പതിനൊന്നു (most Bibles: 21), as printed. Names spelt differently in different places were kept (for example ബെൻഹദാദ് / ബൻഹദാദ്, അഹിഥോഫെൽ / അഹിതോഫെൽ, ലേവ്യർ / ലേവായർ). Names joined with a visible chandrakkala keep a zero-width non-joiner (ദാവീദ്‌രാജാവ്, സൈറസ്‌രാജാവ്).

Worth checking against the book:
- Blurred or faint: 2 Samuel 3:17–25 (page 373), 5:16 (verse number), 15:12, 17:9, 21:16, 23:8, 23:31 (names); 1 Kings 1:48, 18:3 ദൈവത്ത എറെ, 21:5 and 22:24 അരൂപി; 1 Chronicles 7:8, 9:4 and 9:8 (verse numbers), 27:13–21 (page 515, column edge cut), 29:3 (verse number); 2 Chronicles 29:12–14, 34:8–17 and 34:22–24 (names); Ezra 2:4 ഷെഫാത്യർ, 2:26, 8:2 ഇത്താമാര്യരിൽനിന്ന്.
- The long name lists in 1 Chronicles 1–3 (1:5–23, 2:42–55, 3:17–24).
- Words split at a line end, where the print does not show the space, were joined or spaced to match how the print writes them elsewhere (for example 2 Samuel 3:26 ബോർഹസ്സീറായിൽനിന്ന്, 2 Kings 19:24 ഉണക്കി കളഞ്ഞു, 1 Chronicles 29:2 അഞ്ജനവർണക്കല്ലുകൾ, Nehemiah 7:59 പൊക്കെരെത്ഹസ്ബായിമ്യർ).
- Paragraph breaks where a verse starts at the top of a column, which a photo cannot show (1 Kings 20:4, 22:4, 22:14, 22:48; Ezra 4:6; Nehemiah 13:15).

The photos are not in the repository.

Tobit, Judith and Esther were typed in full the same way, one photo per page, with every page there (the first page of Tobit and of Judith only partly in the photo; pages 608 and 628, the book introductions, were not photographed):

| Book | Source files | Pages | Last verses | Verses |
|---|---|---|---|---|
| Tobit | `tools/sources/TOB` | 594–607 | 1:22, 2:14, 3:17, 4:21, 5:23, 6:19, 7:17, 8:21, 9:6, 10:14, 11:19, 12:22, 13:18, 14:15 | 248 |
| Judith | `JDT` | 609–627 | 1:16, 2:28, 3:10, 4:15, 5:24, 6:21, 7:32, 8:36, 9:14, 10:23, 11:23, 12:20, 13:20, 14:19, 15:14, 16:25 | 340 |
| Esther | `EST` | 629–642 | 1:22, 2:23, 3:15, 4:17, 5:14, 6:14, 7:10, 8:17, 9:32, 10:13, 11:12, 12:6, 13:18, 14:19, 15:16, 16:24 | 272 |

Esther: the print has the Greek additions as chapters 11–16, placed inside the story: 11:2–12 and 12:1–6 before chapter 1, 13:1–7 after 3:13, 13:8–18 and 14 after 4:17, 15 after 5:2, 16 after 8:12, and 10:4–13 with 11:1 at the end. Each chapter file holds all of its chapter in verse order, so `13.txt` has both parts, and 11:1 stands before the heading and 11:2 in `11.txt`. The book list now gives Esther 16 chapters. The prayers in Tobit 3, 8 and 13 and Judith's song (16:1–17) are one line per verse; the prayers in Judith 9 and Esther 13–14 are printed as prose.

Obvious misprints corrected: Judith 14:11 പ്രഭാതമായപ്പാൾ → പ്രഭാതമായപ്പോൾ, 12:3 "അവളോടു പറഞ്ഞു." → "പറഞ്ഞു:", and a missing full stop at 16:15. Kept as printed: Tobit 14:4 "നീ മിദിയാനിലേക്കു പോവുക" (the story means Media, മേദിയാ, as in the same verse), 1:14 ഗബ്രിയാസിന്റെ സഹോദരൻ but 4:20 ഗബ്രിയാസിന്റെ പുത്രൻ, നിനെവ / നിനവേ next to നിനെവേ, 10:9 "പറഞ്ഞു." before the speech, 11:8 അവൻകണ്ണു; Judith 4:6 ബത്തൊമെസ്ത്തായിമിലും but 15:4 ബത്തോമസ്തായിം, 16:23 ബത്തുലിയായിൽ (elsewhere ബത്തൂലിയാ), 2:1 അസ്സീറിയരാജാവായ; Esther 15:9 ധൈര്യമായിരിക്കു, ഹമ്മെദാതാ / ഹമ്മെദാഥാ / ഹമ്മേദാഥാ, 2:5 യായീർ but 11:2 ജായീർ, 2:21 ബിഗ്താൻ, തെറെഷ് but 6:2 ബിഗ്താനാ, തെരെഷ്, പുരീം with a short u throughout.

Worth checking against the book:
- Tobit 10:13–14 (faded, read as ഭരമേല്പിക്കപ്പെട്ടവളെ) and Judith 14:15–19 (page 625 is soft; 14:18 വിഡ്ഢികളാക്കിയിരിക്കുന്നു).
- Readings that look odd but seem to be printed: Judith 2:19 പശ്ചിമഘട്ടത്തിലുള്ള, 2:28 വസിച്ചിരുന്നവരുടെയുംമേലും, 5:14 കാദെഷ്ബർണയ, 10:18 ഇളകിവശായി.
- Words split at a line end, where the print does not show the space: joined in Tobit 1:4 and 14:5 (തലമുറകൾക്കുംവേണ്ടി), Judith 16:5 തകിടംമറിച്ചു, 16:23 ബത്തുലിയായിൽവച്ചു, Esther 3:12 രാജമോതിരംകൊണ്ട്, 12:1 കാവൽനിന്നിരുന്ന; kept apart in Esther 16:24 അടുക്കാനാകാത്തതായി തീരുന്നത്.

The photos are not in the repository.

1 and 2 Maccabees were typed in full the same way, one photo per page, with every page there (the first page of each book only partly in the photo, from the heading down):

| Book | Source files | Pages | Last verses | Verses |
|---|---|---|---|---|
| 1 Maccabees | `tools/sources/1MA` | 643–680 | 1:64, 2:70, 3:60, 4:61, 5:68, 6:63, 7:50, 8:32, 9:73, 10:89, 11:74, 12:53, 13:53, 14:49, 15:41, 16:24 | 924 |
| 2 Maccabees | `2MA` | 681–707 | 1:36, 2:32, 3:40, 4:50, 5:27, 6:31, 7:42, 8:36, 9:29, 10:38, 11:38, 12:45, 13:26, 14:46, 15:39 | 555 |

Headings keep no parallel references. Obvious misprints corrected: 2 Maccabees 2:19 മഹാദേവാലത്തിന്റെ → മഹാദേവാലയത്തിന്റെ, 3:6 വിവധതലങ്ങളിൽ… → വിവിധതലങ്ങളിൽ…, 4:4 a missing space in മൂർച്ചകൂട്ടുന്നെന്നുംഓനിയാസ്, 12:2 a missing space after the dash, 1 Maccabees 9:47 a missing space after a full stop; the old-style സൈ്വ in 2 Maccabees 12:11–12 is typed സ്വൈര, as in the other books. Kept as printed: 1 Maccabees 5:28 ബൊസ്രാവഴിയിലേക്ക് (split over the page break as ബൊസ്രാവഴി / യിലേക്ക്), 5:36 കാസ്ഫോ മാക്കെദും, 9:20 ദുഖമാചരിച്ച്, 9:9 നമുക്കതിനു ഒട്ടും, 12:48 ടോളമിയാസിലുള്ളവർ (elsewhere ടോളമായിസ്), 14:18 പിച്ചള but 14:26 പിത്തള, ബത്സൂർ / ബേത്സൂർ / ബേത്ത്സൂർ, 7:37 അവിടത്തെ നാമത്തിൽ in a prayer to God; 2 Maccabees 1:21 നെഹമിയാ (elsewhere നെഹെമിയാ), 5:5 മെനെലാവുസ് next to മെനെലാവൂസ്, 5:8 കുറ്റരോപിതനാക്കപ്പെട്ട, 6:30 (the sentence seems to lack its opening words), 13:22 ഗ്രസിക്കുകയും, 14:17 പെട്ടന്നുള്ള, 14:29 നിർവത്തിയാക്കാനാവുമോ, 14:43 തള്ളിക്കയറിക്കൊണ്ടിരുപ്പോൾ, 15:17 പൗരുഷപൂർണതമായ. Names written with and without a space before രാജാവ് (ദമെത്രിയൂസ് രാജാവ് / ദമെത്രിയൂസ്‌രാജാവ്) are kept as printed; the joined ones with a visible chandrakkala keep a zero-width non-joiner.

Worth checking against the book:
- 1 Maccabees 5:26 കാസ്ഫോ മാക്കെദ് (no comma between the two towns at the line break), 2:37–40 (verse numbers faint in the inner margin), 9:44 കൂടെയുണ്ടായിരുന്നവരോടു (faint ū), 3:52 തൂത്തെറിയാൻ; 2 Maccabees 2:5 ധൂപപീഠവും (the ū looks short), 5:7 കഴിഞ്ഞുള്ളൂ, 10:7 തരുരോഹിണീചക്രങ്ങളാൽ, 12:22 വന്നുഭവിച്ചു (faint).
- Words split at a line end, where the print does not show the space: joined in 1 Maccabees 10:11 സീയോൻമലയും, 7:33 സീയോൻമലയിലേക്കു, 10:13 സ്വദേശത്തേക്കുമടങ്ങി, 8:8 ഇന്ത്യൻപ്രവിശ്യയും, 2 Maccabees 7:38 സഹോദരന്മാരുംവഴി, 7:39 കോപാവേശംപൂണ്ട; kept apart in 1 Maccabees 11:26 ചെയ്തതുപോലെ തന്നെ, 2 Maccabees 5:18 സെല്യൂക്കസ് രാജാവിനാൽ.
- Paragraph breaks where a verse starts at the left margin or the top of a column, which a photo cannot show (1 Maccabees 2:43, 8:3–10; 2 Maccabees 3:4, 4:4, 5:3, 7:12–19, 9:18, 9:23, 10:15, 10:23, 14:36, 15:31).

The photos are not in the repository.

## Source documents
Files sent from ☰ → *ഉറവിട ഫയലുകൾ സൂക്ഷിക്കുക* land in `tools/uploads/<BOOK ID>/<chapter>/<time>-<file name>` (without a chapter: directly in the book's folder). The time is UTC; photos taken in the dialog are named `page-01.jpg`, `page-02.jpg`, … in the order taken, and photos larger than 700 KB are reduced to 2000 px (JPEG, quality 0.8) first, which keeps a page photo at a few hundred KB.
- **On the published site** the Pages Function [`functions/api/sources/upload.js`](functions/api/sources/upload.js) commits each file to `main` on GitHub. The commit message starts with `[CF-Pages-Skip]` (so Cloudflare doesn't redeploy) and records the book, chapter, who sent it and the note. So **`git pull` before working on the repository**, and before pushing.
- **With the local dev server** (`node tools/dev-server.mjs`) the files are written straight into `tools/uploads/` on this computer.
- The function checks the Firebase sign-in token and the same permission as PDF upload (Editor / Admin, or every signed-in user who isn't blocked while upload is open to everyone). One file at most 2 MB; PDF, Word, ODT, RTF, text and images. The limit is low because a Pages Function on the free plan gets about 10 ms of CPU per request and this one needs about 3 ms per MB; bigger files made Cloudflare stop it (Error 1102). Split a large PDF into chapters before sending it.

One-time setup for the published site:
1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**. Repository access: *Only select repositories* → `malayalam-bible`. Permissions → Repository → **Contents: Read and write**. Choose an expiry and generate.
2. Cloudflare → the Pages project → **Settings → Variables and Secrets → Add** (Production, type *Secret*): `GITHUB_TOKEN` = that token. Optional: `GITHUB_REPO` (default `sunilvalarian/malayalam-bible`), `GITHUB_BRANCH` (default `main`).
3. Redeploy (push, or *Deployments → Retry*). Until then the dialog says the storage isn't set up. When the token expires, make a new one and replace the secret.

Turning them into text: ask Claude Code (in this folder) to *process the uploaded source files*. The steps it follows are in [`CLAUDE.md`](CLAUDE.md): read each file, type the chapters into `tools/sources/<BOOK ID>/<chapter>.txt` (or keep a PDF with real text as a chapter PDF), move the originals out of `tools/uploads/`, rebuild `app/js/data.js` and commit. Whatever is still in `tools/uploads/` is waiting.

## Notes on PDFs
The extractor (`app/js/pdf-extract.js`) reads the Unicode text that Google Docs / Chrome embed in the PDF (`ActualText`). Generic tools such as pdf.js scramble this Malayalam text. Scanned (image) PDFs and PDFs that use old ASCII Malayalam fonts (ML-TT etc.) have no usable text, and the upload dialog will say so.
