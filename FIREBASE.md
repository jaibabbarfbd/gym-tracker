# Accounts & cloud backup (Firebase)

Email accounts let people back up their logs and use them on several phones and on the website.
They stay switched off until `js/firebase-config.js` has your Firebase project's settings.
The free Spark plan is enough to start (per day: 50,000 reads, 20,000 writes; 1 GB stored).

## One-time setup (about 10 minutes)

1. Open https://console.firebase.google.com → **Create a project** (name it e.g. `gym-tracker`; Google Analytics can stay off).
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.**
3. **Build → Firestore Database → Create database** → location **asia-south1 (Mumbai)** → **Start in production mode**.
4. **Firestore Database → Rules**: replace everything with the contents of [`firestore.rules`](firestore.rules) → **Publish**.
   This is what keeps each person's data private.
5. **Project settings** (gear icon) → **Your apps** → web icon `</>` → nickname `Gym Tracker` → **Register app** (no Hosting).
   Copy the `firebaseConfig` values into `js/firebase-config.js`:
   ```js
   window.GYM_FIREBASE = {
     apiKey: '…',
     authDomain: '….firebaseapp.com',
     projectId: '…',
     appId: '…',
   };
   ```
   These values are public by design (they're in every web app that uses Firebase). The rules protect the data.
6. **Authentication → Settings → Authorized domains → Add domain**: `jaibabbarfbd.github.io`.
7. Commit and push. The website and the APK pick it up on their next build.

Then **More → Account & backup** shows *Create account / Sign in*, and the first screen on a new phone
offers *I already have an account: sign in*.

## How it works

- Each account's data lives under `users/{uid}`: `chunks/core` (settings, supplements, plans, products)
  and one `chunks/mYYYY-MM` per month of logs, plus `sync/meta` (revision number and a hash per chunk).
- Changes upload about 8 seconds after you make them, and when the app goes to the background.
  Opening the app pulls changes from other phones. Only chunks that changed are read or written.
- Two phones editing at once is fine: records are merged by id (see `merge3` in `js/logic.js`),
  and uploads are revision-checked in a transaction, so a phone that is behind merges first.
- The app lock password and notification bookkeeping stay on each phone.
- People can delete their account (and its backup) in the app, as Google Play requires.

When you add paid plans later, move the project to the Blaze plan and set a budget alert.
