# Malayalam Bible reader

Open **`app/index.html`** in Chrome or Edge (double-click works, no server needed). Editing, uploads and the data tools need a login (or, without Firebase, the local owner passcode — see [Login and permissions](#login-and-permissions)).

## Features
- **Reading**: chapter title, section headings, superscript verse numbers. Swipe or use ← → (or the round buttons) to change chapter. The app remembers where you stopped.
- **Chapter / verse navigation**: tap the `ഉത്പത്തി 1 ▾` button. At the top, pick **പുസ്തകം / അധ്യായം / വാക്യം** together from three dropdowns and press പോകുക. Below that are Book → Chapter → Verse grids, or type a reference: `3`, `3:15`, `3 15`, `12:1-5`, `ഉത്പ 22:2`, `gen 3:15`.
- **Word search** (🔍 or `/`): finds partial words (`അനുഗ്രഹ`). Several words must all appear in the verse. Use `"quotes"` for an exact phrase. "Whole word" option. Search all books, this book, or this chapter.
- **Tap a verse**: highlight (5 colours), copy, share, bookmark, note, edit. Lists are under ☰ → My library.
- **Aa**: font size, line spacing, 4 Malayalam fonts, Light / Sepia / Dark / Auto themes, paragraph or verse-per-line layout.
- **AI translation**: Aa → **പാഠം** switches between **മൂലം** (the app's own translation), **AI പരിഭാഷ** (a Malayalam translation made by Claude straight from the Hebrew / Greek original, not from the app's text) and **രണ്ടും** (the AI translation under each verse, for comparing). ☰ → **AI പരിഭാഷകൾ** lists the chapters whose AI translation is finished; a tap opens one in the AI view. Editors and admins make it per chapter with *AI പരിഭാഷ ഉണ്ടാക്കുക* (or *വീണ്ടും ഉണ്ടാക്കുക*); everyone can read it. See [AI translation](#ai-translation). Needs the login setup (not in local mode).
- **Editing**: ☰ → *ഈ അധ്യായം തിരുത്തുക* opens a side-by-side editor with live preview. Format: `[5]` starts verse 5, `## text` is a heading, each line is a paragraph. The editor warns about missing or out-of-order verse numbers. *യഥാർത്ഥം* restores the original PDF text.
- **Access codes and open editing**: an admin can hand out one-time codes that make someone an editor or admin, and can open PDF upload / chapter editing to everyone who is signed in (see [Login and permissions](#login-and-permissions)).
- **Works without internet**: after one visit online, the reader and the administrator portal open offline too (see [Offline](#offline)). An **ഓഫ്‌ലൈൻ** badge shows in the top bar while there's no connection.
- **Usage log**: everything people do in the app is recorded, also offline, and shown in the portal → **ഉപയോഗം** (see [Usage log](#usage-log)).
- **PDF upload**: ☰ → *PDF അപ്‌ലോഡ്*. Drop one or more PDFs. The book and chapter number are detected (from the file name or an `അധ്യായം N` header) and can be changed. Preview, then save. The chapter becomes part of the reader, and ☰ → *HTML ആയി ഡൗൺലോഡ്* exports a whole book as a single HTML file. Each detected chapter has a *ടെക്സ്റ്റ് തിരുത്തുക* button to fix the text (editor format) before saving.
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

The `functions/` folder (at the repository root, next to `app/`) holds the Cloudflare Pages Functions for passkey sign-in (`/api/passkey/challenge`, `/api/passkey/verify`) and AI translation (`/api/translate`). Pages deploys them automatically; they need the secrets described under *Passkey* and [AI translation](#ai-translation) below and return "not configured" until then. The root `package.json` lists the one npm package the functions use (the Claude SDK, `@anthropic-ai/sdk`); Pages installs it on each deploy. The site in `app/` still has no build step.

## Login and permissions
The published site can use Firebase for login. Permissions are enforced on Firebase's servers by [`firestore.rules`](firestore.rules), so they can't be bypassed from the page source. In the ☰ menu, the whole **ഉള്ളടക്കം** and **ഡാറ്റ** sections are shown only to people who have the permission; the same check guards the buttons, keyboard shortcuts (`e` = edit chapter) and links such as `?open=upload`.

| | Not logged in | Blocked | Reader | Editor | Admin |
|---|:-:|:-:|:-:|:-:|:-:|
| Read, search, highlights / notes in this browser | ✓ | ✓ | ✓ | ✓ | ✓ |
| Own highlights / bookmarks / notes synced across devices | | | ✓ | ✓ | ✓ |
| Edit verses and chapters | | | ✓* | ✓ | ✓ |
| Upload PDFs | | | ✓* | ✓ | ✓ |
| Restore original text (remove an edit) | | | | ✓ | ✓ |
| Make an AI translation of a chapter (reading it: everyone) | | | | ✓ | ✓ |
| Download data.js, backup (.json), book as HTML; restore a backup | | | | ✓ | ✓ |
| Delete chapters, reset all edits | | | | | ✓ |
| Enter an access code (become Editor / Admin) | | | ✓ | ✓ | |
| Administrator portal: usage log, users, roles, invites, access codes, settings, activity, content, passkeys | | | | | ✓ |

\* only while an admin has ticked it in the portal → **ക്രമീകരണങ്ങൾ** (see [Open to everyone](#open-to-everyone-settings)).

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

An admin can invite an e-mail as Editor/Admin before the person signs up; the role applies once they sign in with that e-mail (verified). An admin can't change their own role or the owner's.

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

### AI translation
The AI translation is made by Claude (Anthropic) in the Cloudflare Pages Function [`functions/api/translate.js`](functions/api/translate.js):
- **Who**: only editors and admins can start one (the function checks the Firebase ID token and the role in `users/{uid}`), because each chapter costs a little on the Claude API. Everyone, also visitors, can read the result.
- **What Claude is asked**: translate the chapter from the original-language text (Hebrew / Aramaic, Greek Septuagint for the deuterocanonical books, Greek New Testament) into natural Malayalam, with the names Malayalam Catholics know from the POC Bible, one entry per verse in the app's numbering, plus section headings. It is **not** shown the app's own translation, so the two can be compared. Model `claude-opus-5-5`, effort `medium`; both are constants at the top of the file, next to the prompt. If Claude declines a passage, the request is re-run on Anthropic's recommended fallback model (`fallbacks: "default"`), and the model that answered is shown under the chapter.
- **How**: a chapter is translated 12 verses per request (`PART_SIZE`), so no request runs long and the page shows progress (*1 / 3 …*). Each part gets the last 3 verses before it for continuity. The page must stay open until it's done. A translation that stopped half-way is shown as unfinished and can be made again.
- **Where it is kept**: Firestore `aiTranslations/{BOOK_CH}` (`book, chapter, runId, nParts, verses, parts: { p0: items, p1: … }, done, model, createdBy, createdAt, updatedAt`; items are in the reader's format). `aiIndex/chapters` lists the finished chapters (`chapters: { GEN_1: { book, chapter, verses, model, at } }`) for ☰ → AI പരിഭാഷകൾ, so the list costs one read. The function writes both with the service account. In `firestore.rules`, both are readable by everyone and **writable by nobody**, so nothing labelled "AI" can be typed in by a person. A finished chapter is only replaced through *വീണ്ടും ഉണ്ടാക്കുക* (with a confirmation). It is listed again once the new translation is finished.
- **Reading**: the reader loads a chapter's AI translation (1 Firestore read) only when the AI or "both" view is on. Firestore's offline cache keeps the ones already seen for offline reading. In the AI view, copy / share copy the AI text (marked "AI പരിഭാഷ"), and the verse editor is off (it edits the app's own text).
- **Activity log**: each finished translation is logged as "AI പരിഭാഷ ഉണ്ടാക്കി" (with the model), and shows in the usage log.

Setup:
1. Get an API key at https://console.anthropic.com → **API keys** (add credit under **Billing**).
2. Cloudflare → your Pages project → **Settings → Variables and Secrets → Add** (Production, type *Secret*): `ANTHROPIC_API_KEY` = the key. `FIREBASE_SERVICE_ACCOUNT` must be set too (as for the passkeys, see below).
3. Deploy the rules (`firebase deploy --only firestore:rules`), then redeploy the site (push, or *Deployments → Retry*). Until the key is set, the button answers "AI പരിഭാഷ ഇതുവരെ സജ്ജമാക്കിയിട്ടില്ല".

Cost: a typical chapter (25–35 verses) is 3 requests. The price per chapter depends on its length and is shown in the Anthropic console under **Usage**. Try a few chapters first and check the console before translating whole books.

Locally: `npm install` in the repository root, then run `tools/dev-server.mjs` with `ANTHROPIC_API_KEY` set as well (with the emulator variables below, the function writes to the Firestore emulator).

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
npm run test:unit     # usage log, /api/where, /api/translate, parser (no emulator; /api/translate needs `npm install` in the root)
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

## Notes on PDFs
The extractor (`app/js/pdf-extract.js`) reads the Unicode text that Google Docs / Chrome embed in the PDF (`ActualText`). Generic tools such as pdf.js scramble this Malayalam text. Scanned (image) PDFs and PDFs that use old ASCII Malayalam fonts (ML-TT etc.) have no usable text, and the upload dialog will say so.
