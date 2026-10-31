# Gym Tracker

A personal workout, diet, water, steps, supplement and gym-fee tracker, with friends' streaks and workout sync. It's plain HTML/CSS/JS with no build step. It works offline and can be installed on a phone like an app.

## What it does

- **Diet**: log meals with calories and protein against daily goals.
  - **Search foods & brands**: 188 Indian foods (roti, dal, paneer, biryani, South Indian, street food, sweets…) and 156 branded packaged foods: protein powders (ON, MuscleBlaze, Dymatize, MyProtein…), mass gainers, protein bars, Amul and Epigamia dairy, chocolates, chips & namkeen, biscuits, toffees and candy, cold drinks, spreads, cereals and noodles. Set the number of servings and it's logged with the calories and protein worked out.
  - **🌐 Search every brand online** and **📷 Scan a barcode**: looks the product up in Open Food Facts with its label values per serving. If it isn't there (or has no calories on file), copy it from the label once.
  - **⭐ My products**: products you add or scan are saved for next time, offline too.
  - Or type any food in yourself. Foods you've logged before autofill and show up as one-tap "quick add" chips.
- **Water**: +250 ml / +500 ml buttons against your daily goal.
- **Steps**: typed in from your phone's Health / Fit app or your watch, against a daily goal (default 10,000), with distance and a 7-day average and best. Automatic step counting isn't supported yet.
- **⌚ Watch & heart rate** (More, or the link on the Workout tab): connects over Bluetooth to watches and chest straps that broadcast heart rate (Garmin "Broadcast heart rate", Polar, Coros, Amazfit / Mi Band "Heart rate sharing", most chest straps). It shows live bpm in a floating pill and on the Workout tab, reconnects if the watch drops out, and saves the day's average and max. Bluetooth works in **Chrome on Android, Windows and Mac only**; iPhone browsers don't support it. Watches don't share step counts with websites, which is why watch steps are typed in.
- **Workout**: first pick the day: **💤 Rest day**, **🏋️ Strength** or **🔥 Hybrid (HYROX)**. You can pick it from the Today screen too.
  - **201 exercises**: Chest, Back, Shoulders, Biceps, Triceps, Forearms, Legs, Glutes, Calves, Core, Full Body (Olympic lifts, kettlebells), plus **HYROX** (all 8 stations + the 1 km runs), **Running** and **Conditioning**. Search covers all of them, and you can add your own.
  - **Last time**: every set from your previous session (e.g. `60 kg × 12, 60 kg × 10` or `1000 m in 4:10`)
  - **Today's goal**: progressive overload targets, set by set (rules below)
  - **As you type a weight**: what you did at that exact weight last time
  - Each logged set is marked Beat / Hit / Missed against the goal, with toasts for new PRs and best times.
  - History and PRs per exercise (heaviest, estimated 1-rep max, most reps; or best time for hybrid).
  - **Hybrid days**: one tap adds a **full HYROX simulation** (8 × 1 km runs + SkiErg, Sled Push, Sled Pull, Burpee Broad Jumps, Row, Farmers Carry, Sandbag Lunges, Wall Balls, using Men's Open weights as a starting point). The session shows a running total of your work time. Times can be typed as `4:05`, or just `405` on the number pad.
  - **Rest days**: a recovery card showing how much protein and water you still need today.
  - **Your weekly split**: the app learns what you train on each weekday from the last 4 weeks. Today and the Workout tab show "Usually on Mondays: Bench press, Overhead press…" with one tap to load it, and a "Coming up" list shows the rest of the week.
- **Rest timer**: starts after each logged set (default 90 s, change it in More), with −15 / +15 / Skip. It vibrates and beeps when rest is over.
- **Workout plans** (📋 Plans on the Workout tab): templates (Push, Pull, Legs, Upper, Lower, Full body, HYROX simulation, Hybrid engine), or save today's workout as your own plan. Starting a plan adds all its exercises, each with your last time and today's goal.
- **Progress tab**: body weight with a trend chart and change over 30 days, measurements (waist, chest, arms, thighs, hips, body fat); strength per exercise (estimated 1-rep max per session, or best time for hybrid); weekly volume (kg × reps); and protein, calories and steps for the last 14 days against your goals. Tap a chart for exact values, or open "Show numbers".
- **Account & backup** (More): sign up with email and your logs are backed up and synced, so you can use the app on another phone or on the website. Needs a one-time Firebase setup: see [FIREBASE.md](FIREBASE.md).
- **Android app**: the same app as an APK. See [ANDROID.md](ANDROID.md).
- **Supplements**: pick from **40 supplements** (protein, performance, vitamins & minerals, Ayurvedic like ashwagandha and shilajit, gut/joints/sleep), each with a typical dose and suggested time, or add your own. Whey, gainers and bars can carry their **brand, calories and protein** (pick from the brand list): ticking them off adds them to Diet. Then a daily checklist that shows what's due now, and a 7-day log. Doses are typical label amounts: follow the product label or a doctor.
- **Gym membership**: fee expiry date, a "fees due" banner N days before it expires, and "Mark fees paid", which extends it by your plan length and records the payment.
- **Phone-friendly**: +/− buttons for weight and reps (the weight button moves by the exercise's step), a vibration when a set is logged, the screen stays on while the Workout tab is open, the tab bar hides while the keyboard is up, and there's an install prompt on Android.
- **App lock** 🔒 (optional, More → App lock): asks for your password when the app opens, or after 15 minutes in the background.

### Friends: streaks and workout sync

Tap the 🔥 chip at the top right (or **Friends →** on Today, or **More → Friends & workout sync**).

- **Your streak** 🔥: days in a row with a workout logged (at least one set) or a day marked 💤 Rest. It stays alive until the end of tomorrow, so it isn't lost before today's session.
- **Add a friend**: share your friend code (**Share code**), and type theirs into **Add**. Each of you then sees the other's streak and when they were last active, on the **Streaks** card on Today.
- **👑 I lead workouts**: turn this on and the exercises you add each day are shared. A friend taps **⟳ Sync workout** next to your name, and their Workout tab shows a **👑 Your-name's workout** card. Tapping **⟳ Sync** copies your exercises in your order, with **their own** last-time numbers and goals. If you remove an exercise, their next sync removes it too, unless they already logged a set on it.
- Only your name, your streak and, while leading, the day's exercise list are shared. Sets, weights, meals and everything else stay on your phone.
- Sharing goes through [ntfy.sh](https://ntfy.sh), a free public message relay with no account, under a topic named after your random friend code (only someone with the code can read it). Messages are kept for 12 hours, and the app re-posts while it's open. Your friends' streaks stay correct even if they haven't opened the app for a while, because each status carries its date. The relay code is all in `js/sync.js`, so it can be swapped for your own server later.
- Phones linked with a sync code in the earlier two-person version carry over automatically: the leader's code becomes their friend code with 👑 I lead on, and the other phone gets the leader as a friend.

### App lock

The password keeps others who use your phone out of your data, but it isn't bank-grade security. It's stored as a salted hash, never as plain text, but someone with technical skills and the unlocked phone could still dig the data out of the browser. A forgotten password can't be recovered: "Forgot password?" erases the app's data so you can start again.

### Progressive overload rules

**Weights (double progression).** Each exercise has a rep range (e.g. 8–12, or 5–8 for squats and deadlifts) and a weight step (e.g. 2.5 kg). For every set from last session:

- If you **reached the top of the range**, the goal is **weight + step** at the **bottom** of the range (60 × 12 → 62.5 × 8).
- Otherwise the goal is **same weight, +1 rep** (60 × 10 → 60 × 11).

You can change the range and step per exercise with **Rep range** on the exercise card.

**Hybrid / for time** (runs, ergs, sleds, carries, wall balls, burpees): same distance or reps, **about 2% faster** (at least 1 s, at most 30 s). For example, SkiErg 1000 m in 4:10 → goal 4:05.

**Holds** (plank, dead hang, wall sit, jump rope…): **about 5% longer**, at least 5 s (1:00 → 1:05).

## Run it on your PC

Double-click **`Start Gym Tracker.bat`** (needs [Node.js](https://nodejs.org)), or run:

```
node server.js
```

Then open http://localhost:5173.

## Put it on your phones

The public website is **https://jaibabbarfbd.github.io/gym-tracker/**, published by `.github/workflows/pages.yml` on every push to `main` (one-time setup: repo **Settings → Pages → Source: GitHub Actions**). Android users can also install the APK: see [ANDROID.md](ANDROID.md).

Open the URL on each phone, then:
- **Android (Chrome)**: menu ⋮ → *Add to Home screen* / *Install app*
- **iPhone (Safari)**: Share → *Add to Home Screen*.

Then open the app and enter your name. To connect with friends, tap the 🔥 chip at the top right.

## Reminders

Reminder notifications (water, supplements, gym fees, rest over) are switched off for now. The code is still there: set `REMINDERS = true` at the top of `js/app.js` to bring back the notifications, their settings and the calendar export.

## Your data

Everything is saved in the browser on your phone (localStorage). If you sign in to an account, your logs are also backed up to it (see [FIREBASE.md](FIREBASE.md)). Online food search and barcode lookups go to Open Food Facts. Apart from that and the small friends status above, nothing is uploaded.

- **More → Export backup** saves a `.json` file of your data.
- **More → Restore backup** replaces the app's data with a backup, e.g. on a new phone. The backup keeps your friend code and friends list, so friends stay connected. A password-protected backup asks for its password.
- **More → Erase all my data** wipes the app on this phone.
- If this phone still has a second person's data from the earlier two-person version, it's listed under Backup with **Export** and **Remove**.
- Clearing the browser's site data deletes your logs, so export a backup now and then.

## Files

```
index.html             app shell
css/style.css          styles (always-dark theme)
fonts/                 Manrope font, stored with the app so it works offline (SIL Open Font License, see fonts/OFL.txt)
js/data.js             exercise, Indian food, packaged brand food and supplement lists
js/logic.js            pure logic: overload targets, streaks, weekly split, reminders, dates, calendar export, cloud merge
js/sync.js             friends: sharing streaks and workouts (relay)
js/scan.js             barcode scanning with the camera
js/cloud.js            email accounts and cloud backup (Firebase, loaded on demand)
js/firebase-config.js  your Firebase project settings (see FIREBASE.md)
js/app.js              UI, storage, notifications, sync
sw.js                  offline cache + notification taps
manifest.webmanifest   install info
icons/                 app icons
server.js              tiny local server (no dependencies)
```
