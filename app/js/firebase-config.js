/*
 * Firebase settings for login + shared edits.
 *
 * Leave FIREBASE_CONFIG as null and the app runs in "local mode": no login, and
 * edits stay in this browser (the same as opening the app from disk).
 *
 * To turn on login: Firebase console → Project settings → Your apps → Web app →
 * copy the `firebaseConfig` object here. These values are not secret; access is
 * controlled by the rules in firestore.rules.
 */
window.FIREBASE_CONFIG = null;

// These e-mails are always admin (after e-mail verification). Keep in sync with firestore.rules.
window.APP_OWNERS = ['sunilvalarian@gmail.com'];
