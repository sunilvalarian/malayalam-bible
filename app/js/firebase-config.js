/*
 * Firebase settings for login + shared edits.
 *
 * Leave FIREBASE_CONFIG as null and the app runs in "local mode": no online login and
 * edits stay in this browser. On a public web address local mode is read-only; opened
 * from disk or localhost, the owner can unlock editing with a passcode (this browser only).
 *
 * To turn on login: Firebase console → Project settings → Your apps → Web app →
 * copy the `firebaseConfig` object here. These values are not secret; access is
 * controlled by the rules in firestore.rules.
 */
window.FIREBASE_CONFIG = null;

// These e-mails are always admin (after e-mail verification). Keep in sync with firestore.rules.
window.APP_OWNERS = ['sunilvalarian@gmail.com'];

// These e-mails start as editor (edit chapters, upload PDFs) on their first sign-in, after
// e-mail verification. An admin can change the role later in the portal. Keep in sync with
// presetEditors() in firestore.rules.
window.APP_EDITORS = ['haiabel43@gmail.com'];

// Sign-in methods shown on the login screen (each must also be enabled in Firebase →
// Authentication → Sign-in method; see README). Set one to false to hide its button.
//   passkey needs the Cloudflare Pages Function in functions/ plus the FIREBASE_SERVICE_ACCOUNT secret.
window.AUTH_PROVIDERS = { google: true, github: true, microsoft: true, emailLink: true, password: true, passkey: true };

// Microsoft accounts: 'common' = personal + work/school accounts, 'consumers' = personal only,
// 'organizations' = work/school only, or your Azure tenant ID.
window.MICROSOFT_TENANT = 'common';
