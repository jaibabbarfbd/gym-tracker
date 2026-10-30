# Gym Tracker

A personal workout, diet, water, steps, supplement and gym-fee tracker, with friends' streaks and workout sync. It's plain HTML/CSS/JS with no build step and no dependencies. It works offline and can be installed on a phone like an app.

## What it does

- **Diet**: log meals with calories and protein against daily goals.
  - **Search Indian foods**: 188 foods in 14 categories (roti & breads, rice & biryani, dal, paneer & dairy, eggs, chicken/meat/fish, sabzi, South Indian, snacks, street food, sweets, drinks, fruits & nuts, gym staples), each with a typical serving. Pick one, set the number of servings in steps of 0.5, and it's logged with the calories and protein worked out.
  - Or type any food in yourself. Foods you've logged before autofill and show up as one-tap "quick add" chips.
- **Water**: +250 ml / +500 ml buttons, and a reminder every N minutes between the hours you choose.
- **Steps**: daily step goal (default 10,000, change it in More), with distance and a 7-day average and best.
  - **👟 Count with phone**: counts steps with the phone's motion sensor while the app is **open** (in your hand or pocket; the screen stays on). Phones stop this when the screen turns off or you switch apps, so it's for walks and runs, not all-day counting. On iPhone, allow motion access when asked.
  - **⌚ Enter from watch**: type today's count from your watch's app or your phone's Health / Fit app. Phone and watch steps overlap, so the day uses whichever is **higher**, never the sum.
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
- **Rest timer**: starts after each logged set (default 90 s, change it in More), with −15 / +15 / Skip. It vibrates and beeps when rest is over; in the Android app you also get a notification with the screen off.
- **Workout plans** (📋 Plans on the Workout tab): templates (Push, Pull, Legs, Upper, Lower, Full body, HYROX simulation, Hybrid engine), or save today's workout as your own plan. Starting a plan adds all its exercises, each with your last time and today's goal.
- **Progress tab**: body weight with a trend chart and change over 30 days, measurements (waist, chest, arms, thighs, hips, body fat); strength per exercise (estimated 1-rep max per session, or best time for hybrid); weekly volume (kg × reps); and protein, calories and steps for the last 14 days against your goals. Tap a chart for exact values, or open "Show numbers".
- **Android app**: all-day steps from Health Connect (also with the app closed) and reminders that fire with the app closed. See [ANDROID.md](ANDROID.md).
- **Supplements**: pick from **40 supplements** (protein, performance, vitamins & minerals, Ayurvedic like ashwagandha and shilajit, gut/joints/sleep), each with a typical dose and suggested time, or add your own. Then a daily checklist, a 7-day log, and a "Take your creatine" notification if a dose isn't ticked off. Doses are typical label amounts: follow the product label or a doctor.
- **Gym membership**: fee expiry date, a reminder N days before it expires, and "Mark fees paid", which extends it by your plan length and records the payment.
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

Phones only allow installing and notifications on an **https** site. Upload this folder to any free static host:

- **Netlify Drop**: go to https://app.netlify.com/drop and drag this folder in (a free account keeps the site up).
- **GitHub Pages** or **Cloudflare Pages** work too.

Open the URL on each phone, then:
- **Android (Chrome)**: menu ⋮ → *Add to Home screen* / *Install app*
- **iPhone (Safari)**: Share → *Add to Home Screen*. iOS only allows notifications for home-screen apps.

Then open the app, enter your name, and tap **Enable** on the reminders banner. To connect with friends, tap the 🔥 chip at the top right.

## How reminders work

- **In-app notifications** (water, supplements, fees) fire while the app is open or running in the background. Browsers don't let a website schedule notifications once it's fully closed unless it has a push server.
- For reminders that always fire, go to **More → Download calendar reminders**. This exports your water, supplement and fee reminders as a `.ics` file. Open it on your phone to add them to your calendar, and the calendar's alarms will go off even with the app closed. Export again if you change the times.

## Your data

Everything is saved in the browser on your phone (localStorage). Apart from the small friends status above, nothing is uploaded anywhere.

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
js/data.js             exercise, Indian food and supplement lists
js/logic.js            pure logic: overload targets, streaks, reminders, dates, calendar export
js/sync.js             friends: sharing streaks and workouts (relay)
js/app.js              UI, storage, notifications
sw.js                  offline cache + notification taps
manifest.webmanifest   install info
icons/                 app icons
server.js              tiny local server (no dependencies)
```
