# Gym Tracker for Android

The Android app is the same Gym Tracker, packaged with [Capacitor](https://capacitorjs.com), plus:

- **All-day steps, even with the app closed.** Steps come from Android's **Health Connect**, which records them in the background. While the app is open, the phone's motion sensor adds steps live on top.
- **Reminders that fire with the app closed** (water, supplements, gym fees). Android schedules them.
- **Backups and the calendar file** go through the Android share sheet (save to Files or Drive, or send on WhatsApp).

The GitHub build turns every push into an APK. Nothing needs to be installed on your PC.

## One-time setup: add your signing key to GitHub

Apps must be signed with the same key every time, or phones refuse to install updates over the old app.
Your key was created in **`Desktop\gym-tracker-signing-key`**. Keep that folder private and backed up, and never add it to the repo.

1. Open **github.com/jaibabbarfbd/gym-tracker → Settings → Secrets and variables → Actions**.
2. **New repository secret** → Name `ANDROID_KEYSTORE_BASE64` → Value: paste everything inside `ANDROID_KEYSTORE_BASE64.txt` → **Add secret**.
3. **New repository secret** → Name `ANDROID_KEYSTORE_PASSWORD` → Value: paste everything inside `ANDROID_KEYSTORE_PASSWORD.txt` → **Add secret**.
4. Open the **Actions** tab → **Android app** → **Run workflow** (or just push a change).

Until the secrets exist, each build is a **test build** signed with a throwaway key: it proves the build works, but isn't published. Don't install it.

## Installing on your phone

When a build with your key finishes, the APK is published at a fixed link:

**https://github.com/jaibabbarfbd/gym-tracker/releases/latest/download/gym-tracker.apk**

1. Open that link on your Android phone (Android 8 or newer). The APK downloads.
2. Tap it. If asked, allow your browser to **install unknown apps**, then tap **Install**.
3. Open **Gym Tracker**. On Today, tap **📲 Turn on all-day steps** and allow **Steps** in Health Connect. Tap **Enable** on the reminders banner.

**Updates:** open the same link again and install. It replaces the old app and **keeps your data**.

**Moving from the website:** the app has its own storage. In the website, go to **More → Export backup**. In the app, use **More → Restore backup**.

## If steps stay at 0

Health Connect stores steps that an app records. Phones on Android 14+ have Health Connect built in. On older phones, install **Health Connect** from the Play Store. Something also has to *record* the steps:

- **Samsung**: Samsung Health → Settings → Health Connect → allow it to write steps.
- **Other phones**: Google Fit, or Fitbit, with Health Connect sync turned on.
- **Watches** whose app syncs to Health Connect count too.

Then reopen Gym Tracker. **Today → Steps → Health Connect settings** lets you check the permissions.

## What's different from the website

| | Website | Android app |
|---|---|---|
| Steps while closed | ❌ | ✅ Health Connect |
| Live steps while open | Tap "Count with phone" | Automatic |
| Reminders while closed | ❌ (calendar export instead) | ✅ |
| Live heart rate from a Bluetooth watch | ✅ Chrome | ❌ (use the website) |
| iPhone | ✅ (Add to Home Screen) | ❌ needs a Mac + Apple developer account |

## For developers

```
npm install
npm run build          # copies the web app into www/
npx cap sync android   # copies www/ into the Android project
```

The workflow is `.github/workflows/android.yml`. A new signing key can be made with `node scripts/make-signing-key.js <folder>`, but phones with the app installed would then need to uninstall it first.
