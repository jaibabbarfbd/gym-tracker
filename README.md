# GymBros Tracker

A diet, water, workout, supplement and gym-fee tracker for two (or more) gym partners. It's plain HTML/CSS/JS with no build step and no dependencies. It works offline and can be installed on a phone like an app.

## What it does

- **Diet**: log meals with calories and protein against daily goals.
  - **Search Indian foods**: 188 foods in 14 categories (roti & breads, rice & biryani, dal, paneer & dairy, eggs, chicken/meat/fish, sabzi, South Indian, snacks, street food, sweets, drinks, fruits & nuts, gym staples), each with a typical serving. Pick one, set the number of servings in steps of 0.5, and it's logged with the calories and protein worked out.
  - Or type any food in yourself. Foods you've logged before autofill and show up as one-tap "quick add" chips.
- **Water**: +250 ml / +500 ml buttons, and a reminder every N minutes between the hours you choose.
- **Steps**: daily step goal (default 10,000, change it in More), with distance and a 7-day average and best.
  - **👟 Count with phone**: counts steps with the phone's motion sensor while GymBros is **open** (in your hand or pocket; the screen stays on). Phones stop this when the screen turns off or you switch apps, so it's for walks and runs, not all-day counting. On iPhone, allow motion access when asked.
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
- **Supplements**: pick from **40 supplements** (protein, performance, vitamins & minerals, Ayurvedic like ashwagandha and shilajit, gut/joints/sleep), each with a typical dose and suggested time, or add your own. Then a daily checklist, a 7-day log, and a "Take your creatine" notification if a dose isn't ticked off. Doses are typical label amounts: follow the product label or a doctor.
- **Gym membership**: fee expiry date, a reminder N days before it expires, and "Mark fees paid", which extends it by your plan length and records the payment.
- **Profiles**: one per person. Switch from the top-right chip, or with the Jai / Abhay toggle at the top of the Workout tab.
- **Workout leader** 👑: exercises the leader adds (including custom ones and "repeat a recent workout") are added to everyone else's workout for that day too. Each person still gets their *own* last-time numbers and goals. If the leader removes an exercise, it's also removed for anyone who hasn't logged a set on it yet. The first profile created is the leader. Change it in **More → Workout leader**.
- **Passwords** 🔒: each person can lock their profile in **More → Password**. A locked profile asks for the password when the app opens or when someone switches to it. It stays unlocked until the app is closed, 15 minutes in the background, or **Lock profiles now** (top-right chip).
- **Phone-friendly**: +/− buttons for weight and reps (the weight button moves by the exercise's step), a vibration when a set is logged, the screen stays on while the Workout tab is open, the tab bar hides while the keyboard is up, and there's an install prompt on Android.

### Syncing the workout between two phones

1. **Jai's phone**: More → *Sync between phones* → **I lead: create a sync code** → *Share code* (e.g. on WhatsApp).
2. **Abhay's phone**: More → *Sync between phones* → type the code → **Join**. This is a one-time step.
3. From then on, every exercise Jai adds or removes is sent automatically. On Abhay's Workout tab, a **👑 Jai's workout** card shows what Jai has planned and how many exercises are new. Tapping **⟳ Sync** pulls them in, in Jai's order, each with Abhay's **own** last-time numbers and goal.

Details:
- Only Jai's day type (rest / strength / hybrid), exercise list for the day and Jai's name are sent: no sets, weights, meals, passwords or anything of Abhay's. Abhay's sets stay on Abhay's phone.
- If Jai removes an exercise, the next sync removes it for Abhay too, unless Abhay already logged a set on it.
- The data goes through [ntfy.sh](https://ntfy.sh), a free public message relay that needs no account. It's stored there for 12 hours under a topic named after your random sync code (only someone with the code can read it). While the app is open, Jai's phone re-sends the day's list every couple of hours so it doesn't expire mid-session. The relay code is all in `js/sync.js`, so it can be swapped for your own server or Firebase later.
- Both phones need internet when sending and syncing. If Jai is offline, the send is retried automatically.

### Leader on one shared phone

If both profiles live on the **same** phone, no code is needed: exercises the leader adds are filled straight into the other profile (More → *Workout leader (this phone)*).

### Passwords

The password is a privacy lock between gym partners, not bank-grade security. It's stored as a salted hash, never as plain text, but someone with technical skills and the unlocked phone could still dig the data out of the browser. A forgotten password can't be recovered. The only option is "Forgot password?", which deletes that profile.

### Progressive overload rules

**Weights (double progression).** Each exercise has a rep range (e.g. 8–12, or 5–8 for squats and deadlifts) and a weight step (e.g. 2.5 kg). For every set from last session:

- If you **reached the top of the range**, the goal is **weight + step** at the **bottom** of the range (60 × 12 → 62.5 × 8).
- Otherwise the goal is **same weight, +1 rep** (60 × 10 → 60 × 11).

You can change the range and step per exercise with **Rep range** on the exercise card.

**Hybrid / for time** (runs, ergs, sleds, carries, wall balls, burpees): same distance or reps, **about 2% faster** (at least 1 s, at most 30 s). For example, SkiErg 1000 m in 4:10 → goal 4:05.

**Holds** (plank, dead hang, wall sit, jump rope…): **about 5% longer**, at least 5 s (1:00 → 1:05).

## Run it on your PC

Double-click **`Start GymBros.bat`** (needs [Node.js](https://nodejs.org)), or run:

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

Then open the app, add your name, and tap **Enable** on the reminders banner.

## How reminders work

- **In-app notifications** (water, supplements, fees) fire while the app is open or running in the background. Browsers don't let a website schedule notifications once it's fully closed unless it has a push server.
- For reminders that always fire, go to **More → Download calendar reminders**. This exports your water, supplement and fee reminders as a `.ics` file. Open it on your phone to add them to your calendar, and the calendar's alarms will go off even with the app closed. Export again if you change the times.

## Your data

Everything is saved in the browser on each device (localStorage). Nothing is uploaded anywhere.

- **More → Export my data** saves a backup `.json` of the profile that's open (only yours, never the other person's).
- **More → Import file** loads one. Importing someone's export adds their profile (with its password, if any) to the phone. An import can't overwrite a profile that's currently locked.
- Clearing the browser's site data deletes your logs, so export a backup now and then.

## Files

```
index.html             app shell
css/style.css          styles (always-dark theme)
fonts/                 Manrope font, stored with the app so it works offline (SIL Open Font License, see fonts/OFL.txt)
js/data.js             exercise, Indian food and supplement lists
js/logic.js            pure logic: overload targets, reminders, dates, calendar export
js/sync.js             phone-to-phone workout sync (relay)
js/app.js              UI, storage, notifications
sw.js                  offline cache + notification taps
manifest.webmanifest   install info
icons/                 app icons
server.js              tiny local server (no dependencies)
```
