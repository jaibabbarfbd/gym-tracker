/* Gym Tracker UI: renders each tab from saved state, handles actions, fires reminders. */
(function () {
  'use strict';
  const L = window.GymLogic;
  const STORE_KEY = 'gymbros.v1'; // the app's original name; kept so existing data still loads
  const MEAL_TYPES = ['Breakfast', 'Lunch', 'Snack', 'Pre-workout', 'Post-workout', 'Dinner'];
  const AUTO_LOCK_MS = 15 * 60 * 1000;

  // ---------- Storage ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function defaultProfile(name) {
    return {
      id: uid(),
      name,
      pass: null,
      friendCode: null, // created the first time Friends is opened
      lead: false, // 👑 friends can sync the exercises I add
      follow: null, // friend code whose workout I sync
      friends: [], // { code, name, status, fetchedAt }
      pub: { lastSent: 0, sendError: false, sent: '', wDate: null },
      goals: { cal: 2500, protein: 150, water: 3000, glass: 250, steps: 10000 },
      waterRem: { on: true, every: 60, from: '08:00', to: '22:00' },
      membership: { end: '', fee: '', months: 1, warnDays: 3, payments: [] },
      meals: [],
      water: [],
      workouts: [],
      days: {},
      steps: {}, // date → { phone, manual }
      hr: {}, // date → { sum, n, min, max } heart-rate samples from a watch
      supps: [],
      suppLog: [],
      exCfg: {},
      customEx: [],
      notified: { day: '', keys: {}, water: 0 },
    };
  }

  // Fills in anything missing from older saves or imported files.
  function normalizeProfile(p) {
    const d = defaultProfile(p.name || 'Lifter');
    const out = {
      ...d,
      ...p,
      goals: { ...d.goals, ...p.goals },
      waterRem: { ...d.waterRem, ...p.waterRem },
      membership: { ...d.membership, ...p.membership },
      notified: { ...d.notified, ...p.notified },
      pub: { ...d.pub, ...p.pub },
    };
    // Phones linked with the old one-way sync code become friends: the leader keeps
    // their code as a friend code, the follower gets the leader as a friend.
    if (p.sync?.code) {
      if (p.sync.role === 'lead') Object.assign(out, { friendCode: out.friendCode || p.sync.code, lead: true });
      else if (!out.friends.some((f) => f.code === p.sync.code)) {
        out.friends = [...out.friends, { code: p.sync.code, name: p.sync.leadName || 'Friend', status: null, fetchedAt: 0 }];
        out.follow = out.follow || p.sync.code;
      }
    }
    delete out.sync;
    return out;
  }

  function loadDb() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORE_KEY);
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.profiles)) return { activeId: d.activeId, hideInstall: !!d.hideInstall, profiles: d.profiles.map(normalizeProfile) };
    } catch (e) {
      // Keep an unreadable save aside instead of overwriting it on the next save.
      try { if (raw) localStorage.setItem(`${STORE_KEY}.unreadable-${Date.now()}`, raw); } catch (_) { /* storage unavailable */ }
    }
    return { profiles: [], activeId: null, hideInstall: false };
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(db));
    } catch (e) {
      toast('Could not save. Is browser storage full or blocked?');
    }
    queueNativeReminders(); // app: keep Android's scheduled reminders in step with the data
  }

  let db = loadDb();
  if (db.profiles.length && !db.profiles.some((p) => p.id === db.activeId)) db.activeId = db.profiles[0].id;
  const ui = {
    tab: 'today', date: L.ymd(), openEx: null, pickGroup: 'All', mealType: null, foods: [],
    foodCat: 'All', foodPick: null, foodQty: 1,
    unlocked: new Set(), hiddenAt: 0,
    friendsAt: 0, friendsBusy: false, // last time friends' statuses were fetched
    health: 'unknown', // app: Health Connect step access ('granted' | 'not-granted' | 'unavailable')
    nativeNotif: 'default', // app: Android notification permission, in notifState() terms
  };
  let installEvt = null;
  let wakeLock = null;
  // Phone step counting (works only while the app is open) and a Bluetooth heart-rate watch.
  const pedo = { on: false, push: null, session: 0, pid: null, gotData: false, lastSave: 0 };
  const hrm = { device: null, status: 'off', bpm: 0, name: '', pid: null, lastSave: 0 };
  // App only: steps counted live while open, on top of Health Connect's last number (`base`).
  const live = { on: false, push: null, day: '', base: 0, extra: 0, lastSave: 0 };

  // ---------- Helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const today = () => L.ymd();
  const me = () => db.profiles.find((p) => p.id === db.activeId);
  const isLocked = (p) => !!p.pass && !ui.unlocked.has(p.id);
  const myStreak = (p) => L.streakInfo(p.workouts, p.days, today());
  const followed = (p) => p.friends.find((f) => f.code === p.follow) || null;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const initial = (name) => (name.trim()[0] || '?').toUpperCase();
  const allExercises = (p) => [...L.EXERCISES, ...p.customEx];
  const exById = (p, id) => allExercises(p).find((e) => e.id === id) || { id, name: 'Deleted exercise', group: '', fields: 'wr' };
  const fieldsOf = (ex) => (L.FIELDS.includes(ex?.fields) ? ex.fields : 'wr');
  // "60 kg × 8", "BW × 12", "1000 m in 4:05", "50 m @ 152 kg in 1:40", "1:05" (hold)
  function setText(s, ex) {
    const f = fieldsOf(ex);
    if (f === 'wr') return s.w > 0 ? `${L.fmtW(s.w)} kg × ${s.r}` : `BW × ${s.r}`;
    if (f === 't') return L.fmtDur(s.t);
    const work = [
      f.includes('d') ? `${s.d} m` : '',
      f.includes('r') ? `${s.r} ${ex.unit || 'reps'}` : '',
      f.includes('w') && s.w > 0 ? `@ ${L.fmtW(s.w)} kg` : '',
    ].filter(Boolean).join(' ');
    return `${work} in ${L.fmtDur(s.t)}`;
  }
  const topSet = (sets, ex) => L.bestSet(sets, fieldsOf(ex));

  const DAY_META = {
    rest: { icon: '💤', short: 'Rest', label: 'Rest day', hint: 'Recover & refuel' },
    strength: { icon: '🏋️', short: 'Strength', label: 'Strength training', hint: 'Weights & muscle' },
    hybrid: { icon: '🔥', short: 'Hybrid', label: 'Hybrid (HYROX)', hint: 'HYROX, runs & conditioning' },
  };
  // A day's type is whatever was picked; otherwise it's guessed from the exercises logged.
  function dayType(p, date) {
    if (p.days[date]) return p.days[date];
    const entries = p.workouts.filter((w) => w.date === date);
    if (!entries.length) return null;
    return entries.some((e) => L.HYBRID_GROUPS.includes(exById(p, e.exId).group)) ? 'hybrid' : 'strength';
  }

  const FOOD_LIST = Object.entries(L.FOODS).flatMap(([cat, list]) => list.map(([name, serving, cal, protein]) => ({ name, serving, cal, protein, cat })));
  const SUPP_LIST = Object.entries(L.SUPPLEMENTS).flatMap(([cat, list]) => list.map(([name, dose, times, note]) => ({ name, dose, times, note, cat })));
  const waterOn = (p, d) => p.water.filter((w) => w.date === d).reduce((t, w) => t + w.ml, 0);
  const lastWaterTs = (p) => p.water.reduce((m, w) => Math.max(m, w.ts), 0);
  const isTyping = () => /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
  // 'granted' | 'denied' | 'default' | 'unsupported'. The app uses Android notifications instead of the web ones.
  const notifState = () => (GymNative.isNative ? ui.nativeNotif : 'Notification' in window ? Notification.permission : 'unsupported');
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const buzz = (pattern = 10) => {
    if (navigator.userActivation?.hasBeenActive === false) return;
    try { navigator.vibrate?.(pattern); } catch (e) { /* no haptics */ }
  };

  function defaultMealType() {
    const h = new Date().getHours();
    return h < 11 ? 'Breakfast' : h < 16 ? 'Lunch' : h < 19 ? 'Snack' : 'Dinner';
  }
  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  // ---------- Shared pieces ----------
  function macroBar(label, val, goal, unit, cls) {
    const pct = goal ? Math.min(100, (val / goal) * 100) : 0;
    const left = L.round2(goal - val);
    const foot = left > 0 ? `${left} ${unit} to go` : `Goal hit 💪${left < 0 ? ` (+${-left} ${unit})` : ''}`;
    return `<div class="macro ${cls}">
      <div class="macro-row"><span>${label}</span><span><b>${val}</b> / ${goal} ${unit}</span></div>
      <div class="bar"><span style="width:${pct}%"></span></div>
      <div class="muted small">${foot}</div>
    </div>`;
  }

  function dateNav(d) {
    const t = today();
    const sub = d === t ? `<span class="muted small">${L.fmtDate(d)}</span>` : `<button class="link small" data-action="day-today">Back to today</button>`;
    return `<div class="date-nav">
      <button class="icon-btn" data-action="day" data-n="-1" aria-label="Previous day">‹</button>
      <div class="date-label"><b>${d === t ? 'Today' : L.fmtDate(d)}</b>${sub}</div>
      <button class="icon-btn" data-action="day" data-n="1" aria-label="Next day" ${d >= t ? 'disabled' : ''}>›</button>
    </div>`;
  }

  function installBanner() {
    if (db.hideInstall || isStandalone() || GymNative.isNative) return '';
    const dismiss = '<button class="icon-btn small" data-action="hide-install" aria-label="Dismiss">✕</button>';
    if (installEvt) {
      return `<div class="banner info"><span>📲 Install Gym Tracker as an app</span>
        <div class="row nowrap"><button class="btn small primary" data-action="install">Install</button>${dismiss}</div></div>`;
    }
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
      return `<div class="banner info"><span>📲 Install: tap <b>Share</b>, then <b>Add to Home Screen</b></span>${dismiss}</div>`;
    }
    return '';
  }

  function notifBanner() {
    if (notifState() !== 'default') return '';
    return `<div class="banner info"><span>🔔 Turn on reminders for water, supplements and gym fees</span>
      <button class="btn small primary" data-action="enable-notifs">Enable</button></div>`;
  }

  function membershipBanner(p, ms) {
    if (ms.state !== 'due' && ms.state !== 'expired') return '';
    const fee = p.membership.fee ? ` (${esc(p.membership.fee)})` : '';
    const msg =
      ms.state === 'expired' ? `Gym membership expired ${plural(-ms.daysLeft, 'day')} ago`
      : ms.daysLeft === 0 ? 'Gym membership expires today'
      : `Gym fees due in ${plural(ms.daysLeft, 'day')}`;
    return `<div class="banner ${ms.state === 'expired' ? 'danger' : 'warn'}"><span>💳 ${msg}${fee}</span>
      <button class="btn small" data-action="renew">Mark paid</button></div>`;
  }

  function nextWaterText(p) {
    if (!p.waterRem.on) return 'Reminders off';
    const { next } = L.waterReminder(p.waterRem, lastWaterTs(p), p.notified.water, Date.now());
    return next ? `Next reminder ${L.fmtClock(next)}` : 'No more reminders today';
  }

  function waterCard(p, d) {
    const ml = waterOn(p, d);
    const { water: goal, glass } = p.goals;
    const filled = Math.floor(ml / glass);
    const glasses = Math.min(Math.max(Math.ceil(goal / glass), filled), 20);
    return `<section class="card">
      <div class="card-head"><h2>Water</h2><span class="muted small">${nextWaterText(p)}</span></div>
      <div class="water-amount"><b>${L.fmtL(ml)}</b> / ${L.fmtL(goal)} L</div>
      <div class="glasses" aria-hidden="true">${Array.from({ length: glasses }, (_, i) => `<span class="glass ${i < filled ? 'full' : ''}"></span>`).join('')}</div>
      <div class="row">
        <button class="btn water" data-action="water-add" data-ml="${glass}">+ ${glass} ml</button>
        <button class="btn" data-action="water-add" data-ml="500">+ 500 ml</button>
        <button class="btn ghost" data-action="water-undo" ${ml ? '' : 'disabled'}>Undo</button>
      </div>
    </section>`;
  }

  const fmtInt = (n) => Math.round(n).toLocaleString();
  const fmtShort = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(Math.round(n)));

  // Today at a glance: one ring per daily goal, each named underneath.
  function ringsCard(p, t) {
    const tot = L.dayTotals(p.meals, t);
    const water = waterOn(p, t);
    const steps = L.stepsTotal(p.steps[t]);
    const g = p.goals;
    const rings = [
      ['Calories', 'cal', tot.cal, g.cal, fmtShort(tot.cal), `${fmtInt(tot.cal)} of ${fmtInt(g.cal)} kcal`],
      ['Protein', 'protein', tot.protein, g.protein, `${Math.round(tot.protein)}g`, `${tot.protein} of ${g.protein} g`],
      ['Water', 'water', water, g.water, `${L.fmtL(water)}L`, `${L.fmtL(water)} of ${L.fmtL(g.water)} L`],
      ['Steps', 'steps', steps, g.steps, fmtShort(steps), `${fmtInt(steps)} of ${fmtInt(g.steps)} steps`],
    ];
    const R = 34;
    const C = 2 * Math.PI * R;
    return `<section class="card rings-card" id="rings"><div class="rings">${rings.map(([label, key, val, goal, shown, full]) => {
      const pct = goal ? Math.min(1, val / goal) : 0;
      return `<div class="ring" style="--c: var(--${key})" role="img" aria-label="${label}: ${full}" title="${label}: ${full}">
        <div class="ring-dial">
          <svg viewBox="0 0 80 80" aria-hidden="true">
            <circle class="ring-track" cx="40" cy="40" r="${R}"/>
            ${pct > 0 ? `<circle class="ring-fill" cx="40" cy="40" r="${R}" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(2)}"/>` : ''}
          </svg>
          <b class="ring-val">${shown}</b>
        </div>
        <span class="ring-label">${label}</span>
        <span class="ring-pct">${pct >= 1 ? 'Done ✓' : `${Math.round(pct * 100)}%`}</span>
      </div>`;
    }).join('')}</div></section>`;
  }

  function stepsCard(p, t) {
    const rec = p.steps[t] || {};
    const total = L.stepsTotal(rec);
    const goal = p.goals.steps;
    const left = goal - total;
    const counting = pedo.on && pedo.pid === p.id;
    // Name whichever source gives today's number.
    const top = Math.max(rec.manual || 0, rec.phone || 0, rec.health || 0, rec.live || 0);
    const source = !top ? ''
      : top === (rec.manual || 0) ? '⌚ From your watch / Health app'
      : top === (rec.health || 0) || top === (rec.live || 0) ? `📲 Health Connect${live.on ? ' · live' : ''}`
      : '👟 Counted by phone';
    const week = Array.from({ length: 7 }, (_, i) => L.addDays(t, i - 6)).map((d) => ({ d, n: L.stepsTotal(p.steps[d]) })).filter((x) => x.n);
    const best = week.reduce((a, b) => (b.n > (a?.n || 0) ? b : a), null);
    const avg = week.length ? week.reduce((s, x) => s + x.n, 0) / week.length : 0;
    const watchBtn = '<button class="btn" data-action="steps-manual">⌚ Enter from watch</button>';
    let actions;
    if (GymNative.isNative && ui.health === 'granted') {
      // App: Health Connect counts all day, even with the app closed; live counting adds to it while open.
      actions = `<p class="counting"><span class="dot"></span><span>Counting all day from Health Connect${live.on ? ', live while the app is open' : ''}.</span></p>
        <div class="row steps-actions">${watchBtn}<button class="btn" data-action="health-settings">Health Connect settings</button></div>`;
    } else if (GymNative.isNative && ui.health !== 'unavailable') {
      actions = `<div class="row steps-actions"><button class="btn primary" data-action="health-connect">📲 Turn on all-day steps</button>${watchBtn}</div>
        <p class="muted small week-steps">Reads your steps from Health Connect, which keeps counting with the app closed.</p>`;
    } else {
      const note = GymNative.isNative
        ? '<p class="muted small week-steps">For all-day steps, install or update <b>Health Connect</b> from the Play Store, then reopen the app.</p>'
        : '';
      actions = `${counting ? `<p class="counting"><span class="dot"></span><span>Counting… <b>${fmtInt(pedo.session)}</b> steps this walk. Keep the app open (in your hand or pocket); the screen stays on.</span></p>` : ''}
        <div class="row steps-actions">
          <button class="btn ${counting ? 'stop' : 'primary'}" data-action="pedo-toggle">${counting ? '⏹ Stop counting' : '👟 Count with phone'}</button>
          ${watchBtn}
        </div>${note}`;
    }
    return `<section class="card" id="steps-card">
      <div class="card-head"><h2>Steps</h2><span class="muted small">${source}</span></div>
      <div class="water-amount"><b>${fmtInt(total)}</b> / ${fmtInt(goal)}</div>
      <div class="bar steps"><span style="width:${Math.min(100, (total / goal) * 100)}%"></span></div>
      <div class="muted small">${left > 0 ? `${fmtInt(left)} to go` : 'Goal hit 💪'} · about ${L.round2((total * 0.75) / 1000)} km</div>
      ${actions}
      ${week.length > 1 ? `<p class="muted small week-steps">Last 7 days: avg ${fmtInt(avg)} · best ${fmtInt(best.n)} (${L.fmtDate(best.d).slice(0, 3)})</p>` : ''}
    </section>`;
  }

  // Workout tab: live and average heart rate when a watch has been connected.
  function hrLine(p, d) {
    const rec = p.hr[d];
    const live = hrm.status === 'on' && hrm.pid === p.id && d === today();
    let html = '';
    if (live || rec) {
      html = `❤️ ${live ? `<b>${hrm.bpm || '--'} bpm</b> now` : ''}${live && rec ? ' · ' : ''}${rec ? `avg ${Math.round(rec.sum / rec.n)} · max ${rec.max} today` : ''}`;
    } else if (d === today() && navigator.bluetooth) {
      html = '<button class="link small" data-action="hr-connect">⌚ Connect a heart-rate watch</button>';
    }
    return `<p class="lead-note hr-line" id="hr-line">${html}</p>`;
  }

  function watchSection() {
    if (GymNative.isNative) {
      return `<p class="muted small">Steps from a watch arrive automatically when its app syncs to Health Connect (e.g. Samsung Health, Fitbit, Google Fit). For other watches, use <b>⌚ Enter from watch</b> on the Today screen.</p>
        <p class="muted small">Live heart rate over Bluetooth works in the web version: open the app's website in Chrome.</p>`;
    }
    const status = {
      off: 'Not connected.',
      connecting: `Connecting to ${esc(hrm.name)}…`,
      lost: `Lost ${esc(hrm.name)}. Reconnecting…`,
      on: `✅ Connected to <b>${esc(hrm.name)}</b>${hrm.bpm ? ` · ❤️ ${hrm.bpm} bpm` : ''}`,
    }[hrm.status];
    const button = !navigator.bluetooth ? ''
      : hrm.status === 'off'
        ? '<button class="btn primary block" data-action="hr-connect">Connect heart-rate watch</button>'
        : '<button class="btn block" data-action="hr-disconnect">Disconnect</button>';
    return `<p>${navigator.bluetooth ? status : '⚠️ Bluetooth isn\'t available in this browser. It works in Chrome on Android, Windows and Mac; iPhone browsers don\'t support it.'}</p>
      ${button}
      <p class="muted small">Shows your live heart rate during workouts and saves the day's average and max. Works with watches and chest straps that broadcast heart rate over Bluetooth: Garmin ("Broadcast heart rate"), Polar, Coros, Amazfit / Mi Band ("Heart rate sharing"), and most chest straps. Many other watches, like Apple Watch, Galaxy Watch and most budget watches, don't broadcast without an extra app.</p>
      <p class="muted small">Steps from any watch: copy today's number from its app with <b>⌚ Enter from watch</b> on the Today screen.</p>`;
  }

  function suppChecklist(p, t) {
    const slots = L.suppSlots(p.supps);
    if (!slots.length) return `<p class="muted">No supplements yet. <button class="link" data-action="tab" data-tab="supps">Add your stack →</button></p>`;
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    return `<ul class="checklist">${slots.map(({ supp, slot }) => {
      const taken = L.findTaken(p.suppLog, supp.id, slot, t);
      const due = !taken && slot && L.hmToMin(slot) <= nowMin;
      const when = slot ? L.fmt12(slot) : 'Any time';
      const status = taken ? ` · taken ${L.fmtClock(taken.ts)}` : due ? ' · <span class="warn-text">due now</span>' : '';
      return `<li class="${taken ? 'done' : ''}">
        <button class="check" data-action="supp-toggle" data-id="${esc(supp.id)}" data-slot="${slot}" aria-pressed="${!!taken}" aria-label="Mark ${esc(supp.name)} taken">${taken ? '✓' : ''}</button>
        <div class="grow"><b>${esc(supp.name)}</b> <span class="muted">${esc(supp.dose)}</span>
          <div class="muted small">${when}${status}</div></div>
      </li>`;
    }).join('')}</ul>`;
  }

  // ---------- Friends ----------
  const streakText = (n) => (n ? `🔥 ${plural(n, 'day')}` : 'No streak');

  function lastActiveText(last) {
    if (!last) return 'No workouts yet';
    const n = L.daysBetween(last, today());
    return n === 0 ? 'Active today ✓' : n === 1 ? 'Active yesterday' : `Last active ${L.relDay(last, today())}`;
  }

  // Today: everyone's streak at a glance.
  function friendsCard(p) {
    const mine = myStreak(p);
    const rows = [
      `<li><span class="avatar">${esc(initial(p.name))}</span><div class="grow"><b>You</b><div class="muted small">${lastActiveText(mine.last)}</div></div><span class="streak ${mine.count ? 'on' : ''}">${streakText(mine.count)}</span></li>`,
      ...p.friends.map((f) => {
        const n = L.streakNow(f.status, today());
        return `<li><span class="avatar friend">${esc(initial(f.name))}</span><div class="grow"><b>${esc(f.name)}</b>${f.code === p.follow ? ' <span class="muted small">· syncing</span>' : ''}
          <div class="muted small">${f.status ? lastActiveText(f.status.last) : 'Waiting for them to open the app'}</div></div>
          <span class="streak ${n ? 'on' : ''}">${streakText(n)}</span></li>`;
      }),
    ];
    return `<section class="card" id="friends-card">
      <div class="card-head"><h2>Streaks</h2><button class="link" data-action="open-friends">${p.friends.length ? 'Friends →' : '+ Add friend'}</button></div>
      <ul class="list friends-list">${rows.join('')}</ul>
      ${p.friends.length ? '' : '<p class="muted small">Add a friend to see each other\'s streaks and sync workouts.</p>'}
    </section>`;
  }

  function friendsSheet(p) {
    const mine = myStreak(p);
    const pub = p.pub;
    const leadNote = !p.lead ? 'Friends who sync with you get the exercises you add.'
      : pub.sendError ? '⚠️ Couldn\'t share your latest changes (offline?). Retrying automatically.'
      : pub.lastSent ? `Shared at ${L.fmtClock(pub.lastSent)}. Exercises you add are sent automatically.`
      : 'Exercises you add are sent automatically.';
    return `<div class="sheet-head"><h2>Friends</h2><button class="icon-btn" data-action="close-sheet" aria-label="Close">✕</button></div>
      <div class="friend-hero"><span class="streak big ${mine.count ? 'on' : ''}">${streakText(mine.count)}</span>
        <p class="muted small">Your streak: a workout logged or a rest day marked, every day.</p></div>

      <div class="field-label">Your friend code</div>
      <div class="sync-code">${p.friendCode}</div>
      <div class="row"><button class="btn grow" data-action="code-share">Share code</button><button class="btn grow" data-action="code-copy">Copy</button></div>

      <form data-form="friend-add" class="row add-friend" autocomplete="off">
        <input name="code" placeholder="Friend's code, e.g. 7K3P-9QXM-4D2A" maxlength="20" autocapitalize="characters" spellcheck="false" aria-label="Friend's code">
        <button class="btn primary">Add</button>
      </form>

      <label class="switch lead-switch"><input type="checkbox" data-pref="lead" ${p.lead ? 'checked' : ''}><span><b>👑 I lead workouts</b><span class="muted small block">${leadNote}</span></span></label>

      ${p.friends.length ? `<ul class="list friend-manage">${p.friends.map((f) => {
        const n = L.streakNow(f.status, today());
        const syncing = f.code === p.follow;
        const canSync = f.status?.lead;
        return `<li>
          <span class="avatar friend">${esc(initial(f.name))}</span>
          <div class="grow"><b>${esc(f.name)}</b><div class="muted small">${streakText(n)}${f.status?.lead ? ' · 👑 leads' : ''}</div></div>
          ${syncing ? `<button class="btn small on" data-action="friend-unfollow">✓ Syncing</button>`
            : `<button class="btn small" data-action="friend-follow" data-code="${f.code}" ${canSync ? '' : 'disabled'} title="${canSync ? '' : 'They need to turn on “I lead workouts”'}">⟳ Sync workout</button>`}
          <button class="icon-btn small" data-action="friend-remove" data-code="${f.code}" aria-label="Remove ${esc(f.name)}">✕</button>
        </li>`;
      }).join('')}</ul>` : '<p class="muted small">Share your code with a friend, and add theirs. Each of you sees the other\'s streak.</p>'}
      ${p.friends.some((f) => !f.status?.lead) ? '<p class="muted small">"Sync workout" works once that friend turns on 👑 I lead workouts.</p>' : ''}
      <p class="muted small">Only your name, streak and (when leading) the day's exercise list are shared. Nothing else leaves your phone.</p>`;
  }

  // Workout tab, when syncing a friend's workout.
  function followCard(p) {
    const f = followed(p);
    if (!f) return '';
    const s = f.status;
    const w = s?.w;
    let status = ui.friendsBusy && !s ? 'Checking…' : '';
    let fresh = 0;
    if (!s) status = status || `${esc(f.name)} hasn't opened the app in the last 12 hours.`;
    else if (!s.lead) status = `${esc(f.name)} isn't leading workouts right now.`;
    else if (!w || (!w.ex.length && !w.type)) status = `${esc(f.name)} hasn't picked today's plan yet.`;
    else {
      const day = w.date === today() ? 'Today' : L.fmtDate(w.date);
      const meta = DAY_META[w.type];
      const typeNew = !!w.type && p.days[w.date] !== w.type;
      fresh = w.ex.filter((x) => !p.workouts.some((e) => e.date === w.date && e.exId === x.id)).length + (typeNew ? 1 : 0);
      const names = w.ex.map((x) => x.name || exById(p, x.id).name);
      const what = w.type === 'rest' ? 'Rest day'
        : names.length ? `${esc(names.slice(0, 3).join(', '))}${names.length > 3 ? ` +${names.length - 3}` : ''}`
        : `${meta ? meta.short : 'Workout'}, no exercises yet`;
      status = `${day}: ${meta ? meta.icon + ' ' : ''}${what} · ${fresh ? '<b class="accent-text">new</b>' : '✓ up to date'}`;
    }
    return `<section class="card sync-card" id="follow-card">
      <div class="grow"><b>👑 ${esc(f.name)}'s workout</b><div class="muted small">${status}</div></div>
      <button class="btn small ${fresh ? 'primary' : ''}" data-action="sync-pull" ${ui.friendsBusy ? 'disabled' : ''}>${ui.friendsBusy ? 'Syncing…' : '⟳ Sync'}</button>
    </section>`;
  }

  function leadLine(p) {
    if (!p.lead || !p.friendCode) return '';
    const pub = p.pub;
    const text = pub.sendError ? '⚠️ Couldn\'t share your latest changes. Retrying…'
      : pub.lastSent ? `👑 You're leading · shared ${L.fmtClock(pub.lastSent)}` : '👑 You\'re leading. Friends can sync what you add.';
    return `<p class="lead-note" id="lead-line">${text}</p>`;
  }

  // Redraw the friend pieces in place (no full render, so typing isn't interrupted).
  function refreshFriendsUI() {
    const p = me();
    if (!p || isLocked(p)) return;
    const swap = (sel, html) => { const el = $(sel); if (el) el.outerHTML = html; };
    swap('#friends-card', friendsCard(p));
    swap('#follow-card', followCard(p));
    swap('#lead-line', leadLine(p));
    const chip = $('#profile-chip');
    if (chip) chip.innerHTML = chipHtml(p);
    if (!$('#sheet').hidden && $('#sheet .friend-hero')) $('#sheet').firstElementChild.innerHTML = friendsSheet(p);
  }

  const chipHtml = (p) => {
    const n = myStreak(p).count;
    return `<span class="avatar">${esc(initial(p.name))}</span><span>${n ? `🔥 ${n}` : esc(p.name)}</span>`;
  };

  // Rest day / Strength / Hybrid. `go` jumps to the Workout tab after picking (used on Today).
  function dayTypePicker(p, d, go) {
    const type = dayType(p, d);
    return `<div class="day-types ${type ? '' : 'big'}" role="group" aria-label="Type of day">${L.DAY_TYPES.map((t) => `
      <button class="day-type ${t === type ? 'active' : ''}" data-action="day-type" data-type="${t}" ${go ? 'data-go="1"' : ''} aria-pressed="${t === type}">
        <span class="day-icon">${DAY_META[t].icon}</span><b>${DAY_META[t].short}</b>${type ? '' : `<span class="muted small">${DAY_META[t].hint}</span>`}
      </button>`).join('')}</div>`;
  }

  function trainingCard(p, t, done) {
    const type = dayType(p, t);
    const head = `<div class="card-head"><h2>Training</h2>${type ? `<span class="pill">${DAY_META[type].icon} ${DAY_META[type].short}</span>` : ''}</div>`;
    if (!type) return `<section class="card">${head}<p class="muted">What's the plan today?</p>${dayTypePicker(p, t, true)}</section>`;
    if (type === 'rest') {
      return `<section class="card">${head}
        <p class="muted">Rest day. Recover, hit your protein and sleep well.</p>
        <button class="btn block" data-action="tab" data-tab="workout">Change plan</button>
      </section>`;
    }
    return `<section class="card">${head}
      ${done.length
        ? `<ul class="list compact">${done.map((e) => {
          const ex = exById(p, e.exId);
          return `<li><span class="grow">${esc(ex.name)}</span><span class="muted small">${plural(e.sets.length, 'set')} · best ${setText(topSet(e.sets, ex), ex)}</span></li>`;
        }).join('')}</ul>`
        : '<p class="muted">Nothing logged yet today.</p>'}
      <button class="btn primary block" data-action="tab" data-tab="workout">${done.length ? 'Continue workout' : 'Start workout'}</button>
    </section>`;
  }

  function restCard(p, d) {
    const tips = [];
    if (d === today()) {
      const proteinLeft = L.round2(p.goals.protein - L.dayTotals(p.meals, d).protein);
      const waterLeft = p.goals.water - waterOn(p, d);
      tips.push(proteinLeft > 0 ? `Hit your protein: <b>${proteinLeft} g</b> to go` : 'Protein goal done ✓');
      tips.push(waterLeft > 0 ? `Drink water: <b>${L.fmtL(waterLeft)} L</b> to go` : 'Water goal done ✓');
    }
    tips.push('A light walk or 10 minutes of stretching', 'Sleep 7–9 hours');
    return `<section class="card rest-card">
      <div class="empty-icon">💤</div>
      <h2>Rest day</h2>
      <p class="muted">Muscles grow while you recover.</p>
      <ul class="tips">${tips.map((x) => `<li>${x}</li>`).join('')}</ul>
    </section>`;
  }

  function hybridCard(entries) {
    const total = entries.reduce((sum, e) => sum + e.sets.reduce((s, x) => s + (x.t || 0), 0), 0);
    const hasSim = L.HYROX_SIM.every((id) => entries.some((e) => e.exId === id));
    return `<section class="card hybrid-card">
      <div class="card-head"><h2>🔥 Hybrid session</h2>${total ? `<span class="pill ok">⏱ ${L.fmtDur(total)}</span>` : ''}</div>
      ${hasSim
        ? '<p class="muted small">HYROX simulation: log each 1 km run as a set on "Run 1 km", and each station once.</p>'
        : `<p class="muted small">Stations and runs are logged as distance (or reps) + time. The goal is to be a little faster each time.</p>
          <button class="btn block" data-action="hyrox-sim">Add full HYROX simulation (8 runs + 8 stations)</button>`}
    </section>`;
  }

  // ---------- Views ----------
  function todayView(p) {
    const t = today();
    const tot = L.dayTotals(p.meals, t);
    const ms = L.membershipStatus(p.membership, t);
    const done = p.workouts.filter((w) => w.date === t && w.sets.length);
    const m = p.membership;
    const memberBadge =
      ms.state === 'expired' ? `Expired ${plural(-ms.daysLeft, 'day')} ago`
      : ms.daysLeft === 0 ? 'Expires today'
      : `${plural(ms.daysLeft, 'day')} left`;

    return `${installBanner()}${notifBanner()}${membershipBanner(p, ms)}
      <h1 class="page-title">${greeting()}, ${esc(p.name)}<span class="muted small">${L.fmtDate(t)}</span></h1>

      ${ringsCard(p, t)}

      ${friendsCard(p)}

      <section class="card">
        <div class="card-head"><h2>Nutrition</h2><button class="link" data-action="tab" data-tab="diet">Log meal →</button></div>
        ${macroBar('Calories', tot.cal, p.goals.cal, 'kcal', 'cal')}
        ${macroBar('Protein', tot.protein, p.goals.protein, 'g', 'protein')}
      </section>

      ${waterCard(p, t)}

      ${stepsCard(p, t)}

      <section class="card">
        <div class="card-head"><h2>Supplements</h2><button class="link" data-action="tab" data-tab="supps">Manage →</button></div>
        ${suppChecklist(p, t)}
      </section>

      ${trainingCard(p, t, done)}

      <section class="card">
        <div class="card-head"><h2>Gym membership</h2>${ms.state === 'none' ? '' : `<span class="pill ${ms.state}">${memberBadge}</span>`}</div>
        ${ms.state === 'none'
          ? `<p class="muted">Add your fee expiry date and you'll get reminded before it runs out.</p><button class="btn block" data-action="tab" data-tab="more">Set expiry date</button>`
          : `<p class="muted">Paid until ${L.fmtDate(m.end)}${m.fee ? ` · fee ${esc(m.fee)}` : ''}</p>`}
      </section>`;
  }

  function dietView(p) {
    const d = ui.date;
    const tot = L.dayTotals(p.meals, d);
    const meals = p.meals.filter((m) => m.date === d);
    const type = ui.mealType || defaultMealType();
    ui.foods = L.savedFoods(p.meals);

    const groups = MEAL_TYPES.filter((t) => meals.some((m) => m.type === t)).map((t) => {
      const items = meals.filter((m) => m.type === t);
      const sub = L.dayTotals(items, d);
      return `<div class="meal-group">
        <div class="meal-group-head"><b>${t}</b><span class="muted small">${sub.cal} kcal · ${sub.protein} g</span></div>
        <ul class="list">${items.map((m) => `<li>
          <span class="grow">${esc(m.name)}</span>
          <span class="muted small nowrap">${m.cal} kcal · ${m.protein} g</span>
          <button class="icon-btn small" data-action="del-meal" data-id="${m.id}" aria-label="Delete ${esc(m.name)}">✕</button>
        </li>`).join('')}</ul>
      </div>`;
    });

    return `<h1 class="page-title">Diet</h1>
      ${dateNav(d)}
      <section class="card">
        ${macroBar('Calories', tot.cal, p.goals.cal, 'kcal', 'cal')}
        ${macroBar('Protein', tot.protein, p.goals.protein, 'g', 'protein')}
      </section>

      <section class="card">
        <h2>Add food</h2>
        <button class="btn primary block search-btn" data-action="open-foods">🔍 Search Indian foods</button>
        ${ui.foods.length ? `<div class="sub muted small">Quick add: tap to log again</div>
          <div class="chips scroll">${ui.foods.map((f, i) => `<button class="chip" data-action="quick-food" data-i="${i}">${esc(f.name)} <span class="muted">${f.cal} kcal · ${f.protein} g</span></button>`).join('')}</div>` : ''}
        <div class="sub muted small">Or type it in</div>
        <form data-form="meal" class="stack" autocomplete="off">
          <label>Meal<select name="type" id="meal-type">${MEAL_TYPES.map((t) => `<option ${t === type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label>Food<input name="name" autocomplete="off" list="foods-dl" required maxlength="60" placeholder="e.g. 4 eggs + 2 rotis" enterkeyhint="next"></label>
          <div class="grid2">
            <label>Calories<input name="cal" type="number" inputmode="numeric" min="0" max="10000" step="1" required enterkeyhint="next"></label>
            <label>Protein (g)<input name="protein" type="number" inputmode="decimal" min="0" max="1000" step="0.1" required enterkeyhint="done"></label>
          </div>
          <button class="btn">Add to ${d === today() ? 'today' : L.fmtDate(d)}</button>
        </form>
        <datalist id="foods-dl">${ui.foods.map((f) => `<option value="${esc(f.name)}">`).join('')}</datalist>
      </section>

      <section class="card">
        <h2>Meals</h2>
        ${groups.length ? groups.join('') : '<p class="muted">No meals logged.</p>'}
      </section>`;
  }

  function weightHint(p, entry, raw) {
    if (raw === '' || raw == null || isNaN(+raw)) return '';
    const w = L.round2(+raw);
    const label = w > 0 ? `${L.fmtW(w)} kg` : 'bodyweight';
    const { last, best } = L.repsAtWeight(p.workouts, entry.exId, w, entry.date);
    if (!last) return `No history at ${label} yet. New territory 💪`;
    const cfg = L.exerciseCfg(exById(p, entry.exId), p.exCfg[entry.exId]);
    const top = Math.max(...last.reps);
    const tip = w > 0 && cfg.inc > 0 && top >= cfg.repMax ? ` Range topped out here, ready for ${L.fmtW(w + cfg.inc)} kg.` : '';
    return `At ${label} on ${L.fmtDate(last.date)}: <b>${last.reps.join(', ')} reps</b>${best.r > top ? ` (best ever ${best.r})` : ''}.${tip}`;
  }

  function stepper(id, name, label, value, step, attrs, type = 'number') {
    return `<div class="field">
      <label for="${id}">${label}</label>
      <div class="stepper">
        <button type="button" data-action="step" data-d="-${step}" aria-label="Decrease ${label}">−</button>
        <input id="${id}" name="${name}" type="${type}" value="${value}" ${attrs}>
        <button type="button" data-action="step" data-d="${step}" aria-label="Increase ${label}">+</button>
      </div>
    </div>`;
  }

  // Best timed effort so far, shown under hybrid / hold exercises.
  function timedHint(p, entry, ex, fields) {
    const best = L.bestTimed(p.workouts, entry.exId, fields, entry.date);
    if (!best) return 'First time: log it, and next session you\'ll get a time to beat.';
    return `${fields === 't' ? 'Longest' : 'Best'}: <b>${setText(best.set, ex)}</b> (${L.fmtDate(best.date)})`;
  }

  function exerciseCard(p, entry) {
    const ex = exById(p, entry.exId);
    const cfg = L.exerciseCfg(ex, p.exCfg[ex.id]);
    const f = cfg.fields;
    const lift = f === 'wr';
    const last = L.lastSession(p.workouts, ex.id, entry.date);
    const targets = L.overloadTargets(last, cfg);

    if (ui.openEx !== entry.exId) {
      const summary = entry.sets.length ? `${plural(entry.sets.length, 'set')} · best ${setText(topSet(entry.sets, ex), ex)}` : 'No sets yet';
      return `<section class="card ex-card" id="ex-${esc(entry.exId)}">
        <button class="ex-head" data-action="toggle-ex" data-ex="${esc(entry.exId)}">
          <div><h3>${esc(ex.name)}</h3><div class="muted small">${summary}</div></div><span class="chev">▾</span>
        </button>
      </section>`;
    }

    // Prefill with the next set's goal; first time ever, use the exercise's defaults.
    const next = targets[entry.sets.length] || entry.sets[entry.sets.length - 1] || targets[targets.length - 1]
      || { w: ex.w ?? '', r: ex.r ?? '', d: ex.d ?? '', t: '' };
    const bumped = targets.some((t) => t.up);
    const goalNote = lift
      ? (bumped
        ? `⬆ You hit ${cfg.repMax} reps last time, so add ${L.fmtW(cfg.inc)} kg and restart at ${cfg.repMin}.`
        : `Beat each set by 1 rep. Reach ${cfg.repMax} reps and the weight goes up.`)
      : f === 't' ? 'Hold each one a little longer than last time.' : 'Same work, a little faster than last time.';

    const reference = last
      ? `<div class="ref">
          <div class="ref-label">Last time · ${L.fmtDate(last.date)} <span class="muted">(${L.relDay(last.date, entry.date)})</span></div>
          <div class="sets-line">${last.sets.map((s) => `<span class="set-pill">${setText(s, ex)}</span>`).join('')}</div>
        </div>
        <div class="ref goal">
          <div class="ref-label">🎯 Today's goal</div>
          <div class="sets-line">${targets.map((t) => `<span class="set-pill goal ${t.up ? 'up' : ''}">${setText(t, ex)}${t.up ? ' ⬆' : ''}</span>`).join('')}</div>
          <div class="muted small">${goalNote}</div>
        </div>`
      : `<div class="ref"><div class="muted">First time logging this. Set a baseline and next session you'll get a target to beat.</div></div>`;

    const sets = entry.sets.map((s, i) => {
      const c = L.compareSet(s, targets[i], f);
      const badge = c ? `<span class="badge ${c}">${{ beat: 'Beat ▲', hit: 'Hit ✓', miss: 'Missed ▼' }[c]}</span>` : '';
      return `<li><span class="set-no">${i + 1}</span><b class="grow">${setText(s, ex)}</b>${badge}
        <button class="icon-btn small" data-action="del-set" data-id="${entry.id}" data-i="${i}" aria-label="Delete set ${i + 1}">✕</button></li>`;
    }).join('');

    const id = entry.id;
    const inputs = [];
    if (f.includes('w')) inputs.push(stepper(`w-${id}`, 'w', 'Weight (kg)', next.w ?? '', lift ? cfg.inc || 2.5 : 2.5, 'inputmode="decimal" step="any" min="0" max="1000" placeholder="BW"'));
    if (f.includes('d')) inputs.push(stepper(`d-${id}`, 'd', 'Distance (m)', next.d ?? '', (next.d || ex.d || 0) >= 400 ? 100 : 10, 'inputmode="numeric" step="1" min="1" max="100000" required'));
    if (f.includes('r')) inputs.push(stepper(`r-${id}`, 'r', ex.unit === 'cal' ? 'Calories' : 'Reps', next.r ?? '', 1, 'inputmode="numeric" step="1" min="1" max="1000" required'));
    if (f.includes('t')) inputs.push(stepper(`t-${id}`, 't', 'Time (m:ss)', next.t ? L.fmtDur(next.t) : '', 5, 'inputmode="numeric" placeholder="4:05" required data-time', 'text'));
    const subtitle = lift ? `${cfg.repMin}–${cfg.repMax} reps${cfg.inc ? ` · +${L.fmtW(cfg.inc)} kg steps` : ''}` : f === 't' ? 'Time' : 'For time';

    return `<section class="card ex-card open" id="ex-${esc(entry.exId)}">
      <button class="ex-head" data-action="toggle-ex" data-ex="${esc(entry.exId)}">
        <div><h3>${esc(ex.name)}</h3><div class="muted small">${esc(ex.group)} · ${subtitle}</div></div>
        <span class="chev">▴</span>
      </button>
      ${ex.note ? `<p class="muted small ex-note">${esc(ex.note)}</p>` : ''}
      ${reference}
      ${sets ? `<ol class="set-list">${sets}</ol>` : ''}
      <form class="set-form" data-form="set" data-id="${id}" autocomplete="off">
        ${inputs.join('')}
        <button class="btn primary log-btn">Log set ${entry.sets.length + 1}</button>
      </form>
      <div class="hint small" id="hint-${id}">${lift ? weightHint(p, entry, next.w) : timedHint(p, entry, ex, f)}</div>
      <div class="ex-actions">
        <button class="link small" data-action="ex-history" data-ex="${esc(ex.id)}">History & PRs</button>
        ${lift ? `<button class="link small" data-action="ex-settings" data-ex="${esc(ex.id)}">Rep range</button>` : ''}
        <button class="link small danger" data-action="del-entry" data-id="${id}">Remove</button>
      </div>
    </section>`;
  }

  function workoutView(p) {
    const d = ui.date;
    const type = dayType(p, d);
    const entries = p.workouts.filter((w) => w.date === d).sort((a, b) => a.ts - b.ts);
    const doneIds = new Set(entries.map((e) => e.exId));

    // Recent exercises and recent training days, to repeat with one tap.
    const recentEx = new Map();
    const recentDays = new Map();
    for (const w of p.workouts) {
      if (w.date >= d || !w.sets.length || L.daysBetween(w.date, d) > 21) continue;
      if (!doneIds.has(w.exId) && (recentEx.get(w.exId) || '') < w.date) recentEx.set(w.exId, w.date);
      if (!recentDays.has(w.date)) recentDays.set(w.date, []);
      if (!recentDays.get(w.date).includes(w.exId)) recentDays.get(w.date).push(w.exId);
    }
    const exChips = [...recentEx].sort((a, b) => b[1].localeCompare(a[1])).slice(0, 10);
    const dayChips = [...recentDays].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 4);
    const dayLabel = (ids) => {
      const names = ids.map((id) => exById(p, id).name);
      return names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');
    };

    let body = '';
    if (!type) {
      body = `<p class="plan-q">What's the plan ${d === today() ? 'today' : 'for this day'}?</p>`;
    } else if (type === 'rest') {
      body = restCard(p, d) + entries.map((e) => exerciseCard(p, e)).join('');
    } else {
      body = `${type === 'hybrid' ? hybridCard(entries) : ''}
        ${entries.map((e) => exerciseCard(p, e)).join('')}
        ${entries.length ? '' : `<section class="card empty">
          <div class="empty-icon">${DAY_META[type].icon}</div>
          <h2>No exercises ${d === today() ? 'yet today' : 'on this day'}</h2>
          <p class="muted">${type === 'hybrid'
            ? 'Add HYROX stations, runs or conditioning. You\'ll see your last time and a time to beat.'
            : 'Pick an exercise. You\'ll see what you lifted last time and today\'s target to beat it.'}</p>
        </section>`}
        <button class="btn primary block" data-action="pick-exercise">+ Add exercise</button>
        ${!entries.length && dayChips.length ? `<div class="sub muted small">Repeat a recent workout</div>
          <div class="chips scroll">${dayChips.map(([date, ids]) => `<button class="chip" data-action="repeat-day" data-date="${date}">${DAY_META[dayType(p, date)]?.icon || ''} <b>${L.fmtDate(date)}</b> <span class="muted">${esc(dayLabel(ids))}</span></button>`).join('')}</div>` : ''}
        ${exChips.length ? `<div class="sub muted small">Recent exercises</div>
          <div class="chips scroll">${exChips.map(([id, date]) => `<button class="chip" data-action="add-ex" data-id="${esc(id)}">${esc(exById(p, id).name)} <span class="muted">${L.relDay(date, d)}</span></button>`).join('')}</div>` : ''}`;
    }

    return `<h1 class="page-title">Workout</h1>
      ${leadLine(p)}
      ${followCard(p)}
      ${dateNav(d)}
      ${dayTypePicker(p, d)}
      ${type && type !== 'rest' ? hrLine(p, d) : ''}
      ${body}`;
  }

  function suppsView(p) {
    const t = today();
    const days = Array.from({ length: 7 }, (_, i) => L.addDays(t, i - 6));
    const slots = L.suppSlots(p.supps);
    const grid = `<div class="table-wrap"><table class="grid-table">
      <thead><tr><th></th>${days.map((d) => `<th>${L.fmtDate(d).slice(0, 3)}<br><span class="muted">${L.parseYmd(d).getDate()}</span></th>`).join('')}</tr></thead>
      <tbody>${slots.map(({ supp, slot }) => `<tr><th>${esc(supp.name)}${slot ? `<div class="muted small">${L.fmt12(slot)}</div>` : ''}</th>${days.map((d) => {
        if (d < (supp.created || '')) return '<td class="na">–</td>';
        if (L.findTaken(p.suppLog, supp.id, slot, d)) return '<td class="yes">✓</td>';
        return `<td class="no">${d === t ? '' : '✕'}</td>`;
      }).join('')}</tr>`).join('')}</tbody>
    </table></div>`;

    return `<h1 class="page-title">Supplements</h1>
      <section class="card">
        <div class="card-head"><h2>Today</h2><span class="muted small">${L.fmtDate(t)}</span></div>
        ${suppChecklist(p, t)}
      </section>
      ${slots.length ? `<section class="card"><h2>Last 7 days</h2>${grid}</section>` : ''}
      <section class="card">
        <h2>Your stack</h2>
        <button class="btn primary block search-btn" data-action="open-supps">📋 Choose from ${SUPP_LIST.length} supplements</button>
        ${p.supps.length ? `<ul class="list">${p.supps.map((s) => `<li>
          <div class="grow"><b>${esc(s.name)}</b> <span class="muted">${esc(s.dose)}</span>
            <div class="muted small">${s.times.length ? s.times.map(L.fmt12).join(' & ') : 'Any time, no reminder'}</div></div>
          <button class="icon-btn small" data-action="del-supp" data-id="${esc(s.id)}" aria-label="Delete ${esc(s.name)}">✕</button>
        </li>`).join('')}</ul>` : ''}
        <form data-form="supp" class="stack" autocomplete="off">
          <div class="grid2">
            <label>Name<input name="name" autocomplete="off" required maxlength="30" placeholder="Creatine"></label>
            <label>Dose<input name="dose" maxlength="20" placeholder="5 g"></label>
          </div>
          <div class="grid2">
            <label>Reminder time<input name="t1" type="time" value="09:00"></label>
            <label>2nd time (optional)<input name="t2" type="time"></label>
          </div>
          <button class="btn">Add supplement</button>
        </form>
      </section>`;
  }

  function notifSection() {
    const s = notifState();
    const status = {
      granted: GymNative.isNative ? '✅ Notifications are on. Reminders fire even with the app closed.' : '✅ Notifications are on.',
      denied: GymNative.isNative ? '🚫 Notifications are blocked. Allow them in Android Settings → Apps → Gym Tracker → Notifications.' : '🚫 Notifications are blocked. Allow them in your browser\'s site settings.',
      default: '🔕 Notifications are off.',
      unsupported: '⚠️ This browser can\'t show notifications. On iPhone, add the app to your Home Screen first (Share → Add to Home Screen).',
    }[s];
    return `<p>${status}</p>
      ${s === 'default' ? '<button class="btn primary block" data-action="enable-notifs">Enable notifications</button>' : ''}
      ${s === 'granted' ? '<button class="btn" data-action="test-notif">Send a test notification</button>' : ''}`;
  }

  function moreView(p) {
    const { goals: g, waterRem: r, membership: m } = p;
    const ms = L.membershipStatus(m, today());
    const msText = {
      none: 'No expiry date set.',
      ok: `Paid until ${m.end && L.fmtDate(m.end)} (${plural(ms.daysLeft, 'day')} left).`,
      due: `Fees due: ends ${m.end && L.fmtDate(m.end)}.`,
      expired: `Expired on ${m.end && L.fmtDate(m.end)}.`,
    }[ms.state];
    const others = db.profiles.filter((x) => x.id !== p.id);

    return `<h1 class="page-title">Settings</h1>
      <section class="card">
        <div class="card-head"><h2>Friends</h2><span class="streak ${myStreak(p).count ? 'on' : ''}">${streakText(myStreak(p).count)}</span></div>
        <p class="muted small">${p.friends.length ? `${plural(p.friends.length, 'friend')}${p.lead ? ' · 👑 you lead workouts' : ''}${followed(p) ? ` · syncing ${esc(followed(p).name)}'s workout` : ''}` : 'Add friends to see each other\'s streaks and sync workouts.'}</p>
        <button class="btn primary block" data-action="open-friends">Friends & workout sync</button>
      </section>

      <section class="card">
        <h2>Profile & daily goals</h2>
        <form data-form="goals" class="stack">
          <label>Name<input name="name" autocomplete="off" value="${esc(p.name)}" required maxlength="24"></label>
          <div class="grid2">
            <label>Calories (kcal)<input name="cal" type="number" inputmode="numeric" min="500" max="10000" value="${g.cal}" required></label>
            <label>Protein (g)<input name="protein" type="number" inputmode="numeric" min="10" max="500" value="${g.protein}" required></label>
          </div>
          <div class="grid2">
            <label>Water (ml)<input name="water" type="number" inputmode="numeric" min="500" max="10000" step="50" value="${g.water}" required></label>
            <label>Glass size (ml)<input name="glass" type="number" inputmode="numeric" min="50" max="2000" step="50" value="${g.glass}" required></label>
          </div>
          <label>Steps / day<input name="steps" type="number" inputmode="numeric" min="1000" max="50000" step="500" value="${g.steps}" required></label>
          <button class="btn primary">Save</button>
        </form>
        <p class="muted small">Rule of thumb for lifters: 1.6–2.2 g protein per kg of bodyweight.</p>
      </section>

      <section class="card">
        <h2>App lock</h2>
        <p class="muted small">${p.pass
          ? '🔒 The app asks for your password when it opens, or after 15 minutes in the background.'
          : 'Optional: set a password so nobody else using your phone can open your data.'}</p>
        <form data-form="password" class="stack" autocomplete="off">
          ${p.pass ? '<label>Current password<input name="current" type="password" required autocomplete="current-password"></label>' : ''}
          <div class="grid2">
            <label>${p.pass ? 'New password' : 'Password'}<input name="next" type="password" minlength="4" maxlength="64" autocomplete="new-password" ${p.pass ? '' : 'required'}></label>
            <label>Confirm<input name="confirm" type="password" maxlength="64" autocomplete="new-password" ${p.pass ? '' : 'required'}></label>
          </div>
          <button class="btn primary">${p.pass ? 'Change password' : 'Set password'}</button>
        </form>
        ${p.pass ? '<p class="muted small">To remove the password, enter the current one and leave the new fields empty.</p>' : '<p class="muted small">At least 4 characters. It can\'t be recovered if forgotten.</p>'}
      </section>

      <section class="card">
        <h2>Gym membership</h2>
        <p class="${ms.state === 'ok' || ms.state === 'none' ? 'muted' : 'warn-text'}">${msText}</p>
        <form data-form="membership" class="stack">
          <div class="grid2">
            <label>Fees paid until<input name="end" type="date" value="${m.end}"></label>
            <label>Fee amount<input name="fee" inputmode="decimal" maxlength="12" value="${esc(m.fee)}" placeholder="1500"></label>
          </div>
          <div class="grid2">
            <label>Plan length (months)<input name="months" type="number" inputmode="numeric" min="1" max="24" value="${m.months}" required></label>
            <label>Remind days before<input name="warnDays" type="number" inputmode="numeric" min="0" max="30" value="${m.warnDays}" required></label>
          </div>
          <button class="btn primary">Save membership</button>
        </form>
        ${m.end ? `<button class="btn block" data-action="renew">Mark fees paid (+${plural(m.months, 'month')})</button>` : ''}
        ${m.payments.length ? `<div class="sub muted small">Payments</div><ul class="list compact">${m.payments.slice(0, 6).map((x) => `<li><span class="grow">${L.fmtDate(x.date)}</span><span class="muted small">${x.amount ? esc(x.amount) + ' · ' : ''}until ${L.fmtDate(x.until)}</span></li>`).join('')}</ul>` : ''}
      </section>

      <section class="card">
        <h2>⌚ Watch & heart rate</h2>
        ${watchSection()}
      </section>

      <section class="card">
        <h2>Reminders</h2>
        ${notifSection()}
        <form data-form="water-rem" class="stack">
          <label class="switch"><input type="checkbox" name="on" ${r.on ? 'checked' : ''}><span>Water reminders</span></label>
          <div class="grid3">
            <label>Every (min)<input name="every" type="number" inputmode="numeric" min="15" max="240" step="5" value="${r.every}" required></label>
            <label>From<input name="from" type="time" value="${r.from}" required></label>
            <label>Until<input name="to" type="time" value="${r.to}" required></label>
          </div>
          <button class="btn primary">Save</button>
        </form>
        <p class="muted small">In-app reminders work while the app is open (also in the background). For reminders when it's closed, add them to your phone's calendar:</p>
        <button class="btn block" data-action="ics">📅 Download calendar reminders</button>
      </section>

      <section class="card">
        <h2>Backup</h2>
        <p class="muted small">Your data lives on this phone only. Export a backup now and then; restoring one on a new phone also keeps your friend code, so friends stay connected.</p>
        <div class="row">
          <button class="btn" data-action="export">Export backup</button>
          <label class="btn">Restore backup<input type="file" name="backup" accept="application/json,.json" data-import hidden></label>
        </div>
        ${others.length ? `<div class="sub muted small">Also saved on this phone from the earlier two-person version:</div>
          <ul class="list compact">${others.map((x) => `<li><span class="grow">${esc(x.name)}${x.pass ? ' 🔒' : ''}</span>
            ${x.pass ? '' : `<button class="btn small" data-action="export-other" data-id="${x.id}">Export</button>`}
            <button class="btn small" data-action="remove-other" data-id="${x.id}">Remove</button></li>`).join('')}</ul>` : ''}
        <button class="link small danger" data-action="del-profile">Erase all my data</button>
      </section>`;
  }

  function lockView(p) {
    return `<section class="lock">
      <span class="avatar xl">${esc(initial(p.name))}</span>
      <h1>${esc(p.name)}</h1>
      <p class="muted">Enter your password to open the app.</p>
      <form data-form="unlock" class="stack" autocomplete="off">
        <input name="pw" type="password" required autocomplete="current-password" aria-label="Password" placeholder="Password" enterkeyhint="go">
        <button class="btn primary">Unlock</button>
      </form>
      <button class="link small danger forgot" data-action="forgot-pass">Forgot password?</button>
    </section>`;
  }

  function onboardingView() {
    return `<section class="onboard">
      <img class="onboard-mark" src="icons/icon.svg" alt="" width="88" height="88">
      <h1>Train. Track. Progress.</h1>
      <p class="muted">Workouts with progressive overload, meals and protein, water, steps, supplements and gym fees, all in one place.</p>
      <form data-form="onboard" class="card stack">
        <label>Your name<input name="a" required maxlength="24" placeholder="e.g. Jai" autocomplete="given-name"></label>
        <button class="btn primary">Let's go</button>
      </form>
      <p class="muted small">Training with friends? Add them later to see each other's streaks and sync workouts.</p>
    </section>`;
  }

  // ---------- Sheets ----------
  // Hybrid days list HYROX, running and conditioning first.
  const pickerGroups = (type) => (type === 'hybrid' ? [...L.HYBRID_GROUPS, ...L.STRENGTH_GROUPS] : [...L.STRENGTH_GROUPS, ...L.HYBRID_GROUPS]);

  function pickListHtml(p, q) {
    const query = (q || '').trim().toLowerCase();
    const order = pickerGroups(dayType(p, ui.date));
    const rank = (g) => (order.includes(g) ? order.indexOf(g) : -1);
    // A search looks through every group; otherwise the selected group chip filters.
    const list = allExercises(p)
      .filter((e) => (query ? e.name.toLowerCase().includes(query) : ui.pickGroup === 'All' || e.group === ui.pickGroup))
      .sort((a, b) => rank(a.group) - rank(b.group));
    if (!list.length) return '<li class="muted pad">No match. Add it as a custom exercise below.</li>';
    let lastGroup = null;
    return list.map((e) => {
      const head = ui.pickGroup === 'All' && !query && e.group !== lastGroup ? `<li class="pick-head">${esc(e.group || 'Custom')}</li>` : '';
      lastGroup = e.group;
      const last = L.lastSession(p.workouts, e.id, ui.date);
      const info = last ? `${L.relDay(last.date, ui.date)} · ${setText(topSet(last.sets, e), e)}` : e.group;
      return `${head}<li><button class="pick ${last ? 'has-history' : ''}" data-action="add-ex" data-id="${esc(e.id)}"><span>${esc(e.name)}</span><span class="muted small">${esc(info)}</span></button></li>`;
    }).join('');
  }

  function pickerSheet(p) {
    const groups = ['All', ...pickerGroups(dayType(p, ui.date))];
    return `<div class="sheet-head"><h2>Add exercise</h2><button class="icon-btn" data-action="close-sheet" aria-label="Close">✕</button></div>
      <input class="search" type="search" id="ex-search" placeholder="Search ${allExercises(p).length} exercises" autocomplete="off" enterkeyhint="search">
      <div class="chips scroll" id="ex-groups">${groups.map((g) => `<button class="chip ${g === ui.pickGroup ? 'active' : ''}" data-action="pick-group" data-g="${g}">${g}</button>`).join('')}</div>
      <ul class="pick-list" id="ex-list">${pickListHtml(p, '')}</ul>
      <form data-form="custom-ex" class="custom-ex" autocomplete="off">
        <div class="muted small">Not in the list? Add your own:</div>
        <input name="name" autocomplete="off" placeholder="Exercise name" required maxlength="40">
        <div class="grid2">
          <select name="group" aria-label="Muscle group">${L.GROUPS.map((g) => `<option>${g}</option>`).join('')}</select>
          <select name="fields" aria-label="How it's logged">
            <option value="wr">Weight × reps</option>
            <option value="dt">Distance + time</option>
            <option value="rt">Reps + time</option>
            <option value="t">Time only</option>
          </select>
        </div>
        <button class="btn block">Add custom exercise</button>
      </form>`;
  }

  function historySheet(p, exId) {
    const ex = exById(p, exId);
    const f = fieldsOf(ex);
    const sessions = p.workouts.filter((w) => w.exId === exId && w.sets.length).sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);
    const tile = (label, val, sub) => `<div class="tile"><div class="muted small">${label}</div><b>${val}</b><div class="muted small">${sub}</div></div>`;
    let tiles = '';
    if (sessions.length && f === 'wr') {
      const pb = L.personalBests(p.workouts, exId);
      tiles = tile('Heaviest', setText(pb.heaviest, ex), L.fmtDate(pb.heaviest.date))
        + (pb.best1rm ? tile('Est. 1-rep max', `${L.fmtW(pb.best1rm.v)} kg`, setText(pb.best1rm, ex)) : '')
        + tile('Most reps', setText(pb.mostReps, ex), L.fmtDate(pb.mostReps.date));
    } else if (sessions.length) {
      const best = L.bestTimed(p.workouts, exId, f, '9999-12-31');
      const totalSets = sessions.reduce((n, s) => n + s.sets.length, 0);
      tiles = (best ? tile(f === 't' ? 'Longest' : 'Best', setText(best.set, ex), L.fmtDate(best.date)) : '')
        + tile('Sessions', sessions.length, plural(totalSets, 'set'))
        + tile('Last', L.relDay(sessions[0].date, today()), L.fmtDate(sessions[0].date));
    }
    const body = sessions.length
      ? `<div class="tiles">${tiles}</div>
        <ul class="history">${sessions.map((s) => `<li>
          <div class="history-date"><b>${L.fmtDate(s.date)}</b><span class="muted small">${L.relDay(s.date, today())}</span></div>
          <div class="sets-line">${s.sets.map((x) => `<span class="set-pill">${setText(x, ex)}</span>`).join('')}</div>
        </li>`).join('')}</ul>`
      : '<p class="muted">No sets logged yet.</p>';
    return `<div class="sheet-head"><h2>${esc(ex.name)}</h2><button class="icon-btn" data-action="close-sheet" aria-label="Close">✕</button></div>${body}`;
  }

  function foodListHtml(q) {
    const query = (q || '').trim().toLowerCase();
    const list = FOOD_LIST.map((f, i) => ({ f, i }))
      .filter(({ f }) => (query ? `${f.name} ${f.cat}`.toLowerCase().includes(query) : ui.foodCat === 'All' || f.cat === ui.foodCat));
    if (!list.length) return '<li class="muted pad">No match. Close this and type it in yourself.</li>';
    let lastCat = null;
    return list.map(({ f, i }) => {
      const head = !query && ui.foodCat === 'All' && f.cat !== lastCat ? `<li class="pick-head">${esc(f.cat)}</li>` : '';
      lastCat = f.cat;
      return `${head}<li><button class="pick" data-action="food-pick" data-i="${i}">
        <span>${esc(f.name)}<span class="muted small block">${esc(f.serving)}</span></span>
        <span class="muted small nowrap">${f.cal} kcal · ${f.protein} g</span>
      </button></li>`;
    }).join('');
  }

  const foodTotal = (f, qty) => `<b>${Math.round(f.cal * qty)} kcal</b> · <b>${L.round2(f.protein * qty)} g</b> protein`;

  function foodSheet() {
    const close = '<button class="icon-btn" data-action="close-sheet" aria-label="Close">✕</button>';
    if (ui.foodPick != null) {
      const f = FOOD_LIST[ui.foodPick];
      const type = ui.mealType || defaultMealType();
      return `<div class="sheet-head"><button class="icon-btn" data-action="food-back" aria-label="Back to list">‹</button><h2 class="grow">${esc(f.name)}</h2>${close}</div>
        <p class="muted">1 serving = ${esc(f.serving)} · ${f.cal} kcal · ${f.protein} g protein</p>
        <div class="field">
          <span class="field-label">Servings</span>
          <div class="stepper qty">
            <button type="button" data-action="food-qty" data-d="-0.5" aria-label="Fewer servings">−</button>
            <output id="food-qty">${ui.foodQty}</output>
            <button type="button" data-action="food-qty" data-d="0.5" aria-label="More servings">+</button>
          </div>
        </div>
        <p class="food-total" id="food-total">${foodTotal(f, ui.foodQty)}</p>
        <label>Meal<select id="food-meal">${MEAL_TYPES.map((t) => `<option ${t === type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <button class="btn primary block" data-action="food-add">Add to ${ui.date === today() ? 'today' : L.fmtDate(ui.date)}</button>`;
    }
    return `<div class="sheet-head"><h2>Indian foods</h2>${close}</div>
      <input class="search" type="search" id="food-search" placeholder="Search ${FOOD_LIST.length} foods: roti, paneer, dal…" autocomplete="off" enterkeyhint="search">
      <div class="chips scroll" id="food-cats">${['All', ...Object.keys(L.FOODS)].map((c) => `<button class="chip ${c === ui.foodCat ? 'active' : ''}" data-action="food-cat" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <ul class="pick-list" id="food-list">${foodListHtml('')}</ul>
      <p class="muted small">Typical home-style values. Restaurant portions are often bigger and richer.</p>`;
  }

  function suppListHtml(p, q) {
    const query = (q || '').trim().toLowerCase();
    const list = SUPP_LIST.map((s, i) => ({ s, i })).filter(({ s }) => !query || `${s.name} ${s.cat}`.toLowerCase().includes(query));
    if (!list.length) return '<li class="muted pad">No match. Close this and type it in yourself.</li>';
    let lastCat = null;
    return list.map(({ s, i }) => {
      const head = s.cat !== lastCat ? `<li class="pick-head">${esc(s.cat)}</li>` : '';
      lastCat = s.cat;
      const have = p.supps.some((x) => x.name.toLowerCase() === s.name.toLowerCase());
      return `${head}<li><button class="pick" data-action="supp-pick" data-i="${i}">
        <span>${esc(s.name)}${have ? ' <span class="accent-text">✓</span>' : ''}<span class="muted small block">${esc(s.note)}</span></span>
        <span class="muted small nowrap">${esc(s.dose)}</span>
      </button></li>`;
    }).join('');
  }

  function suppSheet(p) {
    return `<div class="sheet-head"><h2>Supplements</h2><button class="icon-btn" data-action="close-sheet" aria-label="Close">✕</button></div>
      <input class="search" type="search" id="supp-search" placeholder="Search: creatine, whey, D3…" autocomplete="off" enterkeyhint="search">
      <ul class="pick-list" id="supp-list">${suppListHtml(p, '')}</ul>
      <p class="muted small">Typical label doses. Follow the product label or your doctor.</p>`;
  }

  function exSettingsSheet(p, exId) {
    const ex = exById(p, exId);
    const cfg = L.exerciseCfg(ex, p.exCfg[exId]);
    return `<div class="sheet-head"><h2>${esc(ex.name)}</h2><button class="icon-btn" data-action="close-sheet" aria-label="Close">✕</button></div>
      <p class="muted small">Each session the goal is +1 rep per set. Once a set reaches the top of the range, the weight goes up by the step and reps drop back to the bottom.</p>
      <form data-form="ex-cfg" data-ex="${esc(exId)}" class="stack">
        <div class="grid3">
          <label>Min reps<input name="repMin" type="number" inputmode="numeric" min="1" max="100" value="${cfg.repMin}" required></label>
          <label>Max reps<input name="repMax" type="number" inputmode="numeric" min="1" max="100" value="${cfg.repMax}" required></label>
          <label>Step (kg)<input name="inc" type="number" inputmode="decimal" min="0" max="50" step="0.25" value="${cfg.inc}" required></label>
        </div>
        <button class="btn primary">Save</button>
      </form>`;
  }

  function openSheet(html) {
    const s = $('#sheet');
    s.firstElementChild.innerHTML = html;
    s.hidden = false;
    document.body.classList.add('no-scroll');
  }
  function closeSheet() {
    $('#sheet').hidden = true;
    document.body.classList.remove('no-scroll');
  }

  // ---------- Render ----------
  const VIEWS = { today: todayView, diet: dietView, workout: workoutView, supps: suppsView, more: moreView };

  function render() {
    const p = me();
    const chip = $('#profile-chip');
    const locked = !!p && isLocked(p);
    $('#tabs').hidden = !p || locked;
    chip.hidden = !p || locked;
    if (!p) {
      $('#view').innerHTML = onboardingView();
    } else if (locked) {
      $('#view').innerHTML = lockView(p);
      if (matchMedia('(pointer: fine)').matches) $('#view input[name="pw"]').focus();
    } else {
      chip.innerHTML = chipHtml(p);
      document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
      $('#view').innerHTML = VIEWS[ui.tab](p);
      // Re-check friends when their info is on screen; sooner on Workout when syncing someone.
      const maxAge = ui.tab === 'workout' && p.follow ? 15000 : 60000;
      if ((ui.tab === 'today' || ui.tab === 'workout') && p.friends.length && Date.now() - ui.friendsAt > maxAge) pollFriends();
    }
    updateLive(false);
    updateWakeLock();
  }

  // Keep the screen on while the Workout tab is showing.
  async function updateWakeLock() {
    const p = me();
    const want = 'wakeLock' in navigator && !document.hidden && !!p && !isLocked(p) && (ui.tab === 'workout' || pedo.on);
    if (want && !wakeLock) {
      wakeLock = 'pending';
      try {
        const lock = await navigator.wakeLock.request('screen');
        wakeLock = lock;
        lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
      } catch (e) {
        wakeLock = null;
      }
    } else if (!want && wakeLock && wakeLock !== 'pending') {
      const lock = wakeLock;
      wakeLock = null;
      lock.release().catch(() => {});
    }
  }

  function toast(html, ms = 3500) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = html;
    const box = $('#toasts');
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild.remove();
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
  }

  function download(name, text, type) {
    // The app can't download into the browser's folder: hand the file to the Android share sheet.
    if (GymNative.isNative) {
      GymNative.shareFile(name, text).catch(() => toast('Couldn\'t share the file.'));
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Mutations ----------
  function addMeal(m) {
    me().meals.push({ id: uid(), date: ui.date, ts: Date.now(), ...m });
    ui.mealType = m.type;
    save();
    render();
    toast(`Added ${esc(m.name)}: ${m.cal} kcal · ${m.protein} g protein`);
  }

  function addToWorkout(p, date, exIds) {
    exIds.forEach((exId, i) => {
      if (p.workouts.some((w) => w.date === date && w.exId === exId)) return;
      p.workouts.push({ id: uid(), date, exId, sets: [], ts: Date.now() + i });
    });
    save();
    queuePublish(p);
  }

  // ---------- Friends: sharing and fetching ----------
  // Your status (name, streak, today's workout when leading) goes out shortly after anything
  // that could change it; quick taps are batched.
  let publishTimer = null;
  let publishing = false;
  let publishAgain = false;
  function queuePublish(p) {
    if (!p?.friendCode) return;
    clearTimeout(publishTimer);
    publishTimer = setTimeout(() => {
      publishTimer = null;
      publishNow();
    }, 1500);
  }

  async function publishNow(force) {
    if (publishing) {
      publishAgain = true;
      return;
    }
    const p = me();
    if (!p?.friendCode) return;
    const t = today();
    const entries = p.workouts.filter((w) => w.date === t).sort((a, b) => a.ts - b.ts);
    const workout = p.lead ? L.workoutPayload(p.name, t, dayType(p, t), entries, p.customEx) : null;
    const payload = L.statusPayload({ name: p.name, streak: myStreak(p), lead: p.lead, workout });
    const key = JSON.stringify({ ...payload, ts: 0 });
    // Unchanged and sent recently: nothing to do (the relay keeps messages for 12 hours).
    if (!force && key === p.pub.sent && !p.pub.sendError && Date.now() - p.pub.lastSent < 2 * 3600 * 1000) return;
    publishing = true;
    let ok = true;
    try {
      await GymSync.publish(p.friendCode, payload);
    } catch (e) {
      ok = false;
    }
    publishing = false;
    const q = me(); // the saved data may have been reloaded meanwhile
    if (q?.id === p.id) {
      Object.assign(q.pub, ok ? { lastSent: Date.now(), sendError: false, sent: key } : { sendError: true });
      save();
      refreshFriendsUI();
    }
    if (publishAgain) {
      publishAgain = false;
      publishNow();
    }
  }

  // Latest status of every friend. A status the relay no longer has (older than 12 hours)
  // keeps the last one we saw; the streak shown is still right because it carries its date.
  let pollPromise = null;
  function pollFriends() {
    const p = me();
    if (!p?.friends.length) return Promise.resolve();
    if (pollPromise) return pollPromise;
    ui.friendsBusy = true;
    refreshFriendsUI();
    pollPromise = Promise.all(p.friends.map(async (f) => {
      try {
        const s = await GymSync.fetchLatest(f.code);
        if (s) Object.assign(f, { status: s, name: s.by });
        f.error = false;
      } catch (e) {
        f.error = true;
      }
      f.fetchedAt = Date.now();
    })).then(() => {
      ui.friendsAt = Date.now();
      ui.friendsBusy = false;
      pollPromise = null;
      save();
      refreshFriendsUI();
    });
    return pollPromise;
  }

  // Copy the followed friend's workout into today's (their order, your own targets).
  async function syncFollowed() {
    const p = me();
    let f = followed(p);
    if (!f) return;
    await pollFriends();
    f = followed(me());
    if (!f) return;
    if (f.error && !f.status) return toast('Couldn\'t reach the sync server. Check your internet.');
    const w = f.status?.lead ? f.status.w : null;
    if (!w || (!w.ex.length && !w.type)) return toast(`Nothing to sync yet from ${esc(f.name)}.`);
    const { added, removed, typeChanged } = applyRemote(me(), w);
    ui.date = w.date;
    ui.openEx = ui.openEx && w.ex.some((x) => x.id === ui.openEx) ? ui.openEx : w.ex[0]?.id ?? null;
    render();
    buzz(20);
    const parts = [
      typeChanged && w.type ? `${DAY_META[w.type].icon} ${DAY_META[w.type].label}` : '',
      added ? `${plural(added, 'exercise')} added` : '',
      removed ? `${removed} removed` : '',
    ].filter(Boolean);
    toast(parts.length ? `⟳ Synced ${esc(f.name)}'s workout: ${parts.join(', ')}` : '✓ Already up to date');
  }

  // Adds the leader's exercises in the leader's order. Ones the leader dropped are removed
  // again, unless sets were already logged on them.
  function applyRemote(p, data) {
    const ids = data.ex.map((x) => x.id);
    for (const x of data.ex) {
      if (x.name && !p.customEx.some((c) => c.id === x.id)) p.customEx.push({ id: x.id, name: x.name, group: x.group, fields: x.fields, inc: 2.5, repMin: 8, repMax: 12 });
    }
    const typeChanged = !!data.type && p.days[data.date] !== data.type;
    if (data.type) p.days[data.date] = data.type;
    const before = p.workouts.length;
    p.workouts = p.workouts.filter((w) => !(w.date === data.date && w.synced && !w.sets.length && !ids.includes(w.exId)));
    const removed = before - p.workouts.length;
    let added = 0;
    ids.forEach((exId, i) => {
      if (p.workouts.some((w) => w.date === data.date && w.exId === exId)) return;
      p.workouts.push({ id: uid(), date: data.date, exId, sets: [], ts: Date.now() + i, synced: true });
      added++;
    });
    save();
    queuePublish(p);
    return { added, removed, typeChanged };
  }

  // Every 30 s: share any change (and re-share every 2 h so it doesn't expire on the relay),
  // and refresh friends' streaks while Today or Workout is showing.
  function syncTick() {
    const p = me();
    if (!p || document.hidden) return;
    if (p.friendCode) publishNow();
    // Sooner while a synced friend's workout is on screen, so their card updates by itself.
    const maxAge = ui.tab === 'workout' && p.follow ? 15000 : 120000;
    if (p.friends.length && !isLocked(p) && (ui.tab === 'today' || ui.tab === 'workout') && Date.now() - ui.friendsAt > maxAge) pollFriends();
  }

  function ensureFriendCode(p) {
    if (p.friendCode) return;
    p.friendCode = L.newSyncCode();
    save();
    publishNow(true); // so friends who add you see your name straight away
  }

  function addExercise(exId) {
    addToWorkout(me(), ui.date, [exId]);
    ui.openEx = exId;
    closeSheet();
    render();
    document.getElementById(`ex-${exId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function logTimedSet(p, entry, ex, fields, fd) {
    const set = {};
    if (fields.includes('w')) set.w = L.round2(Math.max(0, +fd.get('w') || 0));
    if (fields.includes('d')) set.d = Math.round(+fd.get('d'));
    if (fields.includes('r')) set.r = Math.round(+fd.get('r'));
    set.t = L.parseDur(fd.get('t'));
    if ('d' in set && !(set.d > 0)) return toast('Enter the distance in metres.');
    if ('r' in set && !(set.r > 0)) return toast(`Enter the ${ex.unit === 'cal' ? 'calories' : 'reps'}.`);
    if (!set.t) return toast('Enter a time like 4:05 (or just type 405).');

    const prev = L.bestTimed(p.workouts, entry.exId, fields, L.addDays(entry.date, 1));
    entry.sets.push(set);
    save();
    render();
    buzz(25);
    queuePublish(p); // the streak may change
    if (prev && L.compareSet(set, prev.set, fields) === 'beat') {
      toast(`⚡ New best on ${esc(ex.name)}: ${esc(setText(set, ex))}`);
    }
  }

  function deleteProfile(p) {
    // Don't leave the step counter or a watch recording for a profile that's gone.
    if (pedo.on && pedo.pid === p.id) stopPedometer(true);
    if (hrm.status !== 'off' && hrm.pid === p.id) disconnectWatch();
    db.profiles = db.profiles.filter((x) => x !== p);
    db.activeId = db.profiles[0]?.id || null;
    ui.unlocked.delete(p.id);
    ui.tab = 'today';
    save();
    render();
  }

  async function importFile(input) {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const backup = (data.profiles || []).filter((x) => x && x.id && x.name).map(normalizeProfile)[0];
      if (!backup) throw new Error('no profile');
      // The export time is stored in UTC; show the backup's date in local time.
      const exported = new Date(data.exported);
      const when = isNaN(exported) ? '' : ` from ${L.fmtDate(L.ymd(exported))}`;
      if (!confirm(`Restore the backup of ${backup.name}${when}?\nThis replaces the data in the app on this phone.`)) return;
      // Restoring replaces you; a password-protected backup asks for its password.
      const current = me();
      db.profiles = [backup, ...db.profiles.filter((x) => x.id !== backup.id && x.id !== current?.id)];
      db.activeId = backup.id;
      ui.tab = 'today';
      save();
      render();
      toast(`Backup restored${when}`);
      queuePublish(backup);
    } catch (e) {
      toast('That file isn\'t a backup from this app.');
    }
  }

  // ---------- Notifications ----------
  async function notify(title, body, tag) {
    toast(`<b>${esc(title)}</b><br>${esc(body)}`, 6000);
    if (notifState() !== 'granted') return;
    if (GymNative.isNative) {
      GymNative.notifyAt(900100, title, body, new Date(Date.now() + 1000)).catch(() => {});
      return;
    }
    const opts = { body, tag, renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: [120, 60, 120] };
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg) await reg.showNotification(title, opts);
      else new Notification(title, opts);
    } catch (e) { /* the toast already showed it */ }
  }

  async function enableNotifs() {
    if (notifState() === 'unsupported') return toast('This browser can\'t show notifications.');
    let res;
    if (GymNative.isNative) {
      ui.nativeNotif = nativePerm(await GymNative.notifPermission(true));
      res = ui.nativeNotif;
      queueNativeReminders(true);
    } else {
      res = await Notification.requestPermission();
    }
    render();
    if (res === 'granted') notify('Reminders are on 💪', 'You\'ll get nudges for water, supplements and gym fees.', 'welcome');
  }

  // ---------- App (Android) ----------
  const nativePerm = (s) => (s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : s === 'unsupported' ? 'unsupported' : 'default');

  // Android schedules the reminders itself, so they fire with the app closed. Recomputed after
  // every save; only sent to Android when the list actually changes.
  let reminderTimer = null;
  let remindersSent = '';
  function queueNativeReminders(force) {
    if (!GymNative.isNative || ui.nativeNotif !== 'granted') return;
    clearTimeout(reminderTimer);
    reminderTimer = setTimeout(async () => {
      const p = me();
      const list = p ? L.nativeReminders(p, Date.now()) : [];
      const key = JSON.stringify(list);
      if (!force && key === remindersSent) return;
      try {
        await GymNative.setReminders(list.map((r) => (r.at ? { ...r, at: new Date(r.at) } : r)));
        remindersSent = key;
      } catch (e) { /* tried again on the next change */ }
    }, 1000);
  }

  // Today's steps from Health Connect. Steps counted live since the last reading stay on top
  // until Health Connect catches up.
  async function refreshHealth() {
    if (!GymNative.isNative || ui.health !== 'granted') return;
    let n;
    try {
      n = await GymNative.stepsToday();
    } catch (e) {
      return;
    }
    const p = me();
    if (!p) return;
    const t = today();
    const rec = p.steps[t] || (p.steps[t] = {});
    rec.health = n;
    if (live.day !== t || n >= live.base + live.extra) Object.assign(live, { day: t, base: n, extra: 0 });
    rec.live = live.base + live.extra;
    save();
    updateLive();
  }

  function onLiveMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const n = live.push(a.x, a.y, a.z, e.timeStamp || performance.now());
    const p = n && me();
    if (!p) return;
    const t = today();
    if (live.day !== t) Object.assign(live, { day: t, base: 0, extra: 0 }); // just past midnight
    live.extra += n;
    const rec = p.steps[t] || (p.steps[t] = {});
    rec.live = live.base + live.extra;
    if (Date.now() - live.lastSave > 10000) {
      live.lastSave = Date.now();
      save();
    }
    updateLive();
  }

  // While the app is open, the phone's motion sensor adds steps right away.
  function startLive() {
    if (live.on || !GymNative.isNative || ui.health !== 'granted' || document.hidden || !('DeviceMotionEvent' in window)) return;
    Object.assign(live, { on: true, push: L.createStepDetector() });
    window.addEventListener('devicemotion', onLiveMotion);
  }
  function stopLive() {
    if (!live.on) return;
    live.on = false;
    window.removeEventListener('devicemotion', onLiveMotion);
    save();
  }

  async function initNative() {
    if (!GymNative.isNative) return;
    ui.nativeNotif = nativePerm(await GymNative.notifPermission(false));
    ui.health = await GymNative.stepsAccess();
    if (ui.health === 'granted') {
      await refreshHealth();
      startLive();
    }
    queueNativeReminders(true);
    if (!isTyping() && $('#sheet').hidden) render();
  }

  // Runs every 30 s; each reminder fires once.
  function checkReminders() {
    if (GymNative.isNative) return; // the app schedules them with Android instead
    const now = Date.now();
    const t = L.ymd();
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    let changed = false;

    for (const p of [me()].filter(Boolean)) {
      const n = p.notified;
      if (n.day !== t) {
        n.day = t;
        n.keys = {};
        changed = true;
      }

      if (L.waterReminder(p.waterRem, lastWaterTs(p), n.water, now).due) {
        n.water = now;
        changed = true;
        const left = p.goals.water - waterOn(p, t);
        notify(`Drink water 💧`, left > 0 ? `${L.fmtL(left)} L to go today.` : 'Goal done, keep sipping.', `water-${p.id}`);
      }

      for (const { supp, slot } of L.suppSlots(p.supps)) {
        const key = `supp:${supp.id}:${slot}`;
        if (!slot || L.hmToMin(slot) > nowMin || n.keys[key] || L.findTaken(p.suppLog, supp.id, slot, t)) continue;
        n.keys[key] = true;
        changed = true;
        notify(`Take your ${supp.name} 💊`, `${supp.dose ? supp.dose + ' · ' : ''}scheduled for ${L.fmt12(slot)}`, `supp-${p.id}-${supp.id}-${slot}`);
      }

      const ms = L.membershipStatus(p.membership, t);
      if ((ms.state === 'due' || ms.state === 'expired') && !n.keys.fee) {
        n.keys.fee = true;
        changed = true;
        const fee = p.membership.fee ? ` Fee: ${p.membership.fee}.` : '';
        const msg =
          ms.state === 'expired' ? `Membership expired ${plural(-ms.daysLeft, 'day')} ago.`
          : ms.daysLeft === 0 ? 'Membership expires today.'
          : `Membership ends in ${plural(ms.daysLeft, 'day')} (${L.fmtDate(p.membership.end)}).`;
        notify(`Gym fees due 💳`, msg + fee, `fee-${p.id}`);
      }
    }

    if (changed) {
      save();
      if (!isTyping() && $('#sheet').hidden) render();
    }
  }

  // ---------- Steps & watch ----------
  // Floating pill above the tabs while the step counter or a watch is running.
  function updateLive(cards = true) {
    const p = me();
    const bits = [];
    if (pedo.on) bits.push(`👟 ${fmtInt(pedo.session)} steps`);
    if (hrm.status === 'on') bits.push(`❤️ ${hrm.bpm || '--'} bpm`);
    else if (hrm.status !== 'off') bits.push('❤️ connecting…');
    const live = $('#live');
    live.hidden = !bits.length || !p || isLocked(p);
    live.innerHTML = bits.map((b) => `<span>${b}</span>`).join('');
    if (!cards || !p || isLocked(p)) return;
    const card = $('#steps-card');
    if (card) card.outerHTML = stepsCard(p, today());
    const rings = $('#rings');
    if (rings) rings.outerHTML = ringsCard(p, today());
    const line = $('#hr-line');
    if (line) line.outerHTML = hrLine(p, ui.date);
  }

  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    pedo.gotData = true;
    const n = pedo.push(a.x, a.y, a.z, e.timeStamp || performance.now());
    const p = n && db.profiles.find((x) => x.id === pedo.pid);
    if (!p) return;
    const rec = p.steps[today()] || (p.steps[today()] = {});
    rec.phone = (rec.phone || 0) + n;
    pedo.session += n;
    if (Date.now() - pedo.lastSave > 5000) {
      pedo.lastSave = Date.now();
      save();
    }
    updateLive();
  }

  async function startPedometer() {
    if (!('DeviceMotionEvent' in window)) return toast('This device has no motion sensor. Enter steps from your watch instead.');
    // iPhone asks for motion access, and only from a tap.
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        if (await DeviceMotionEvent.requestPermission() !== 'granted') return toast('Motion access was blocked. Allow it for this site in Safari settings.');
      } catch (e) {
        return toast('Couldn\'t get motion access.');
      }
    }
    Object.assign(pedo, { on: true, push: L.createStepDetector(), session: 0, pid: me().id, gotData: false, lastSave: Date.now() });
    window.addEventListener('devicemotion', onMotion);
    render();
    setTimeout(() => {
      if (pedo.on && !pedo.gotData) {
        stopPedometer(true);
        toast('No motion sensor found here. Use a phone, or enter steps from your watch.');
      }
    }, 3000);
  }

  function stopPedometer(quiet) {
    window.removeEventListener('devicemotion', onMotion);
    const n = pedo.session;
    pedo.on = false;
    save();
    render();
    updateLive();
    if (!quiet) toast(n ? `👟 ${fmtInt(n)} steps added to today` : 'No steps picked up. Walk with the phone in your hand or pocket.');
  }

  async function connectWatch() {
    if (!navigator.bluetooth) return toast('Bluetooth needs Chrome on Android or a computer.');
    try {
      const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
      Object.assign(hrm, { device, name: device.name || 'Heart-rate monitor', pid: me().id });
      device.addEventListener('gattserverdisconnected', onWatchLost);
      await attachWatch();
      toast(`⌚ Connected to ${esc(hrm.name)}`);
    } catch (e) {
      hrm.status = 'off';
      if (e.name !== 'NotFoundError') toast(`Couldn't connect: ${esc(e.message)}`); // NotFoundError = picker closed
    }
    render();
    updateLive();
  }

  async function attachWatch() {
    hrm.status = 'connecting';
    updateLive();
    const server = await hrm.device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    const measurement = await service.getCharacteristic('heart_rate_measurement');
    measurement.addEventListener('characteristicvaluechanged', onHeartRate);
    await measurement.startNotifications();
    hrm.status = 'on';
    updateLive();
  }

  function onHeartRate(e) {
    const bpm = L.parseHeartRate(e.target.value);
    const p = db.profiles.find((x) => x.id === hrm.pid);
    if (!(bpm >= 30 && bpm <= 240) || !p) return;
    hrm.bpm = bpm;
    const rec = p.hr[today()] || (p.hr[today()] = { sum: 0, n: 0, min: bpm, max: bpm });
    rec.sum += bpm;
    rec.n++;
    rec.min = Math.min(rec.min, bpm);
    rec.max = Math.max(rec.max, bpm);
    if (Date.now() - hrm.lastSave > 15000) {
      hrm.lastSave = Date.now();
      save();
    }
    updateLive();
  }

  // Watches drop out when they go out of range; try a few times to get them back.
  async function onWatchLost() {
    if (hrm.status === 'off') return;
    hrm.status = 'lost';
    save();
    updateLive();
    for (let i = 1; i <= 3 && hrm.status === 'lost'; i++) {
      await new Promise((r) => setTimeout(r, 2000 * i));
      try {
        await attachWatch();
        return;
      } catch (e) { /* retry */ }
    }
    if (hrm.status === 'lost') {
      hrm.status = 'off';
      toast('⌚ Watch disconnected');
      render();
      updateLive();
    }
  }

  function disconnectWatch() {
    hrm.status = 'off';
    hrm.bpm = 0;
    try { hrm.device?.gatt?.disconnect(); } catch (e) { /* already gone */ }
    hrm.device = null;
    save();
    render();
    updateLive();
  }

  function stepsSheet(p) {
    const rec = p.steps[today()] || {};
    return `<div class="sheet-head"><h2>Steps from your watch</h2><button class="icon-btn" data-action="close-sheet" aria-label="Close">✕</button></div>
      <p class="muted small">Open your watch's app (Noise Fit, boAt Crest, Zepp, Galaxy Wearable, Garmin Connect…) or your phone's Health / Fit app and type today's step count.</p>
      <form data-form="steps-manual" class="stack" autocomplete="off">
        <label>Today's steps<input name="steps" type="number" inputmode="numeric" min="0" max="200000" value="${rec.manual ?? ''}" placeholder="e.g. 8450" required></label>
        <button class="btn primary">Save</button>
      </form>
      <p class="muted small">${rec.phone ? `The phone counted ${fmtInt(rec.phone)} today. ` : ''}The app uses whichever number is higher, so steps are never counted twice.</p>`;
  }

  // ---------- Event handling ----------
  const ACTIONS = {
    tab(el) {
      ui.tab = el.dataset.tab;
      ui.date = today();
      ui.openEx = null;
      render();
      window.scrollTo(0, 0);
    },
    day(el) {
      const d = L.addDays(ui.date, +el.dataset.n);
      if (d > today()) return;
      ui.date = d;
      ui.openEx = null;
      render();
    },
    'day-today'() {
      ui.date = today();
      render();
    },
    'water-add'(el) {
      const p = me();
      p.water.push({ id: uid(), date: today(), ts: Date.now(), ml: +el.dataset.ml });
      save();
      render();
      buzz();
      const left = p.goals.water - waterOn(p, today());
      if (left <= 0 && left > -el.dataset.ml) toast('💧 Water goal hit!');
    },
    'water-undo'() {
      const p = me();
      const i = p.water.map((w) => w.date).lastIndexOf(today());
      if (i < 0) return;
      p.water.splice(i, 1);
      save();
      render();
    },
    'supp-toggle'(el) {
      const p = me();
      const t = today();
      const { id, slot } = el.dataset;
      const taken = L.findTaken(p.suppLog, id, slot, t);
      if (taken) p.suppLog = p.suppLog.filter((l) => l !== taken);
      else p.suppLog.push({ id: uid(), suppId: id, slot, date: t, ts: Date.now() });
      save();
      render();
      buzz();
    },
    'del-supp'(el) {
      const p = me();
      const s = p.supps.find((x) => x.id === el.dataset.id);
      if (!s || !confirm(`Remove ${s.name} from your stack?`)) return;
      p.supps = p.supps.filter((x) => x !== s);
      save();
      render();
    },
    'quick-food'(el) {
      const f = ui.foods[+el.dataset.i];
      if (f) addMeal({ name: f.name, cal: f.cal, protein: f.protein, type: $('#meal-type')?.value || defaultMealType() });
    },
    'del-meal'(el) {
      const p = me();
      p.meals = p.meals.filter((m) => m.id !== el.dataset.id);
      save();
      render();
    },
    'pedo-toggle'() {
      if (pedo.on) stopPedometer();
      else startPedometer();
      buzz();
    },
    'steps-manual'() {
      openSheet(stepsSheet(me()));
    },
    async 'health-connect'() {
      const res = await GymNative.requestSteps();
      ui.health = res === 'unsupported' ? 'unavailable' : res;
      if (res === 'granted') {
        await refreshHealth();
        startLive();
        toast('📲 All-day steps are on');
      } else if (res === 'unavailable') {
        toast('Health Connect isn\'t available. Install or update "Health Connect" from the Play Store.');
      } else {
        toast('Steps access wasn\'t allowed. You can turn it on in Health Connect settings.');
      }
      render();
    },
    'health-settings'() {
      GymNative.openHealthSettings();
    },
    'hr-connect'() {
      connectWatch();
    },
    'hr-disconnect'() {
      disconnectWatch();
    },
    'day-type'(el) {
      const p = me();
      if (el.dataset.go) ui.date = today();
      const type = el.dataset.type;
      p.days[ui.date] = type;
      save();
      queuePublish(p);
      if (el.dataset.go && type !== 'rest') ui.tab = 'workout';
      render();
      buzz();
    },
    'hyrox-sim'() {
      addToWorkout(me(), ui.date, L.HYROX_SIM);
      ui.openEx = L.HYROX_SIM[0];
      render();
      toast('HYROX simulation added: 8 × 1 km runs + 8 stations');
    },
    'open-foods'() {
      ui.foodPick = null;
      openSheet(foodSheet());
    },
    'food-cat'(el) {
      ui.foodCat = el.dataset.c;
      document.querySelectorAll('#food-cats .chip').forEach((c) => c.classList.toggle('active', c.dataset.c === ui.foodCat));
      $('#food-list').innerHTML = foodListHtml($('#food-search').value);
    },
    'food-pick'(el) {
      ui.foodPick = +el.dataset.i;
      ui.foodQty = 1;
      openSheet(foodSheet());
    },
    'food-back'() {
      ui.foodPick = null;
      openSheet(foodSheet());
    },
    'food-qty'(el) {
      ui.foodQty = Math.max(0.5, Math.min(20, ui.foodQty + +el.dataset.d));
      $('#food-qty').textContent = ui.foodQty;
      $('#food-total').innerHTML = foodTotal(FOOD_LIST[ui.foodPick], ui.foodQty);
      buzz(8);
    },
    'food-add'() {
      const f = FOOD_LIST[ui.foodPick];
      const q = ui.foodQty;
      const type = $('#food-meal').value;
      closeSheet();
      addMeal({
        name: `${f.name} · ${q === 1 ? f.serving : `${q} × ${f.serving}`}`,
        cal: Math.round(f.cal * q),
        protein: L.round2(f.protein * q),
        type,
      });
    },
    'open-supps'() {
      openSheet(suppSheet(me()));
    },
    // Fills the add form so the time can be checked before saving.
    'supp-pick'(el) {
      const s = SUPP_LIST[+el.dataset.i];
      closeSheet();
      const f = $('form[data-form="supp"]');
      f.elements.name.value = s.name;
      f.elements.dose.value = s.dose;
      f.elements.t1.value = s.times[0] || '';
      f.elements.t2.value = s.times[1] || '';
      f.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast(`${esc(s.name)}: ${esc(s.note)}. Check the time, then tap Add supplement.`, 5000);
    },
    'pick-exercise'() {
      ui.pickGroup = dayType(me(), ui.date) === 'hybrid' ? 'HYROX' : 'All';
      openSheet(pickerSheet(me()));
      if (matchMedia('(pointer: fine)').matches) $('#ex-search').focus();
    },
    'pick-group'(el) {
      ui.pickGroup = el.dataset.g;
      document.querySelectorAll('#ex-groups .chip').forEach((c) => c.classList.toggle('active', c.dataset.g === ui.pickGroup));
      $('#ex-list').innerHTML = pickListHtml(me(), $('#ex-search').value);
    },
    'add-ex'(el) {
      addExercise(el.dataset.id);
    },
    'repeat-day'(el) {
      const p = me();
      const ids = [];
      for (const w of p.workouts.filter((x) => x.date === el.dataset.date && x.sets.length).sort((a, b) => a.ts - b.ts)) {
        if (!ids.includes(w.exId)) ids.push(w.exId);
      }
      addToWorkout(p, ui.date, ids);
      ui.openEx = ids[0] || null;
      render();
    },
    'toggle-ex'(el) {
      ui.openEx = ui.openEx === el.dataset.ex ? null : el.dataset.ex;
      render();
    },
    step(el) {
      const input = el.parentElement.querySelector('input');
      if (input.hasAttribute('data-time')) input.value = L.fmtDur(Math.max(1, (L.parseDur(input.value) || 0) + +el.dataset.d));
      else input.value = Math.max(input.name === 'w' ? 0 : 1, L.round2((+input.value || 0) + +el.dataset.d));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      buzz(8);
    },
    'del-set'(el) {
      const entry = me().workouts.find((w) => w.id === el.dataset.id);
      if (!entry) return;
      entry.sets.splice(+el.dataset.i, 1);
      save();
      render();
      queuePublish(me()); // the streak may change
    },
    'del-entry'(el) {
      const p = me();
      const entry = p.workouts.find((w) => w.id === el.dataset.id);
      if (!entry || (entry.sets.length && !confirm(`Remove ${exById(p, entry.exId).name} and its ${plural(entry.sets.length, 'set')}?`))) return;
      p.workouts = p.workouts.filter((w) => w !== entry);
      save();
      render();
      queuePublish(p);
    },
    'ex-history'(el) {
      openSheet(historySheet(me(), el.dataset.ex));
    },
    'ex-settings'(el) {
      openSheet(exSettingsSheet(me(), el.dataset.ex));
    },
    'close-sheet'() {
      closeSheet();
    },
    'open-friends'() {
      const p = me();
      if (!p || isLocked(p)) return;
      ensureFriendCode(p);
      openSheet(friendsSheet(p));
      pollFriends();
    },
    async 'code-share'() {
      const { friendCode } = me();
      const link = location.protocol === 'https:' ? `\n${location.origin}${location.pathname}` : '';
      const text = `Add me on Gym Tracker to see each other's streaks: open the app → Friends → enter my code ${friendCode}${link}`;
      if (GymNative.isNative) {
        GymNative.shareText(text).catch(() => {});
      } else if (navigator.share) {
        try { await navigator.share({ text }); } catch (e) { /* share sheet closed */ }
      } else {
        ACTIONS['code-copy']();
      }
    },
    async 'code-copy'() {
      try {
        await navigator.clipboard.writeText(me().friendCode);
        toast('Code copied');
      } catch (e) {
        toast('Copy blocked. Long-press the code to copy it.');
      }
    },
    'friend-follow'(el) {
      const p = me();
      p.follow = el.dataset.code;
      save();
      refreshFriendsUI();
      toast(`⟳ Syncing ${esc(followed(p)?.name || 'your friend')}'s workout. Tap Sync on the Workout tab.`);
    },
    'friend-unfollow'() {
      me().follow = null;
      save();
      refreshFriendsUI();
    },
    'friend-remove'(el) {
      const p = me();
      const f = p.friends.find((x) => x.code === el.dataset.code);
      if (!f || !confirm(`Remove ${f.name} from your friends?`)) return;
      p.friends = p.friends.filter((x) => x !== f);
      if (p.follow === f.code) p.follow = null;
      save();
      refreshFriendsUI();
    },
    'forgot-pass'() {
      const typed = prompt('A forgotten password can\'t be recovered: everything is stored only on this phone.\n\nType DELETE to erase all your data in the app so you can start again.');
      if (typed === 'DELETE') deleteProfile(me());
    },
    'del-profile'() {
      if (confirm('Erase all your data in the app on this phone? This can\'t be undone. Export a backup first if you might want it.')) deleteProfile(me());
    },
    'export-other'(el) {
      const x = db.profiles.find((y) => y.id === el.dataset.id);
      if (!x || x.pass) return;
      const data = { app: 'gym-tracker', version: 2, exported: new Date().toISOString(), profiles: [x] };
      download(`gym-tracker-${x.name.replace(/\W+/g, '-').toLowerCase()}-${today()}.json`, JSON.stringify(data), 'application/json');
    },
    'remove-other'(el) {
      const x = db.profiles.find((y) => y.id === el.dataset.id);
      if (!x || !confirm(`Remove ${x.name}'s saved data from this phone? This can't be undone.`)) return;
      db.profiles = db.profiles.filter((y) => y !== x);
      save();
      render();
    },
    renew() {
      const p = me();
      const m = p.membership;
      const t = today();
      const until = L.addMonths(m.end && m.end >= t ? m.end : t, m.months || 1);
      if (!confirm(`Mark gym fees as paid?\nMembership will run until ${L.fmtDate(until)}.`)) return;
      m.payments.unshift({ date: t, amount: m.fee, until });
      m.end = until;
      delete p.notified.keys.fee;
      save();
      render();
      toast(`Fees paid 💳 Good until ${L.fmtDate(until)}`);
    },
    install() {
      if (!installEvt) return;
      installEvt.prompt();
      installEvt.userChoice.finally(() => {
        installEvt = null;
        render();
      });
    },
    'hide-install'() {
      db.hideInstall = true;
      save();
      render();
    },
    'enable-notifs'() {
      enableNotifs();
    },
    'test-notif'() {
      notify('Test reminder 💪', 'Notifications are working.', 'test');
    },
    ics() {
      const p = me();
      const { ics, count } = L.buildICS(p, today());
      if (!count) return toast('Nothing to schedule yet. Add supplements, water reminders or a membership date first.');
      download(`gym-tracker-reminders-${p.name.replace(/\W+/g, '-').toLowerCase()}.ics`, ics, 'text/calendar');
      toast(`${plural(count, 'reminder')} exported. Open the file to add them to your calendar.`);
    },
    'sync-pull'() {
      syncFollowed();
    },
    // The backup keeps your friend code and friends, so restoring it on a new phone keeps you connected.
    export() {
      const p = me();
      const data = { app: 'gym-tracker', version: 2, exported: new Date().toISOString(), profiles: [p] };
      download(`gym-tracker-${p.name.replace(/\W+/g, '-').toLowerCase()}-${today()}.json`, JSON.stringify(data), 'application/json');
    },
  };

  const FORMS = {
    onboard(f, fd) {
      const name = (fd.get('a') || '').trim();
      if (!name) return;
      db.profiles = [defaultProfile(name)];
      db.activeId = db.profiles[0].id;
      save();
      render();
    },
    unlock(f, fd) {
      const p = me();
      if (L.checkPassword(fd.get('pw'), p.pass)) {
        ui.unlocked.add(p.id);
        render();
        toast(`Welcome back, ${esc(p.name)} 💪`);
        return;
      }
      f.elements.pw.value = '';
      f.classList.remove('shake');
      void f.offsetWidth; // restart the animation
      f.classList.add('shake');
      buzz([40, 40, 40]);
      toast('Wrong password');
    },
    password(f, fd) {
      const p = me();
      const next = fd.get('next');
      if (p.pass && !L.checkPassword(fd.get('current'), p.pass)) return toast('Current password is wrong');
      if (next !== fd.get('confirm')) return toast('The two new passwords don\'t match');
      if (!next) {
        if (!p.pass || !confirm(`Remove the password from ${p.name}'s profile?`)) return;
        p.pass = null;
        save();
        render();
        return toast('Password removed');
      }
      if (next.length < 4) return toast('Use at least 4 characters');
      p.pass = L.makePassword(next);
      ui.unlocked.add(p.id);
      save();
      render();
      toast('Password saved 🔒');
    },
    meal(f, fd) {
      const name = fd.get('name').trim();
      const cal = Math.round(+fd.get('cal'));
      const protein = L.round2(+fd.get('protein'));
      if (!name || !(cal >= 0) || !(protein >= 0)) return;
      addMeal({ name, cal, protein, type: fd.get('type') });
    },
    set(f, fd) {
      const p = me();
      const entry = p.workouts.find((w) => w.id === f.dataset.id);
      if (!entry) return;
      const ex = exById(p, entry.exId);
      const fields = fieldsOf(ex);
      if (fields !== 'wr') return logTimedSet(p, entry, ex, fields, fd);
      const w = L.round2(+fd.get('w') || 0);
      const r = Math.round(+fd.get('r'));
      if (!(r > 0) || w < 0) return;

      const prevBest1rm = L.personalBests(p.workouts, entry.exId).best1rm;
      const prevAtWeight = L.repsAtWeight(p.workouts, entry.exId, w, L.addDays(entry.date, 1)).best;
      entry.sets.push({ w, r });
      save();
      render();
      buzz(25);
      queuePublish(p); // the streak may change

      const v = L.e1rm(w, r);
      if (prevBest1rm && v > prevBest1rm.v) toast(`🏆 New PR on ${esc(exById(p, entry.exId).name)}! Est. 1-rep max ${L.fmtW(v)} kg`);
      else if (prevAtWeight && r > prevAtWeight.r) toast(`🔥 Rep record at ${w > 0 ? L.fmtW(w) + ' kg' : 'bodyweight'}: ${r} reps (was ${prevAtWeight.r})`);
    },
    supp(f, fd) {
      const name = fd.get('name').trim();
      if (!name) return;
      const times = [...new Set([fd.get('t1'), fd.get('t2')].filter(Boolean))];
      me().supps.push({ id: uid(), name, dose: fd.get('dose').trim(), times, created: today() });
      save();
      render();
      toast(`${esc(name)} added${times.length ? `. Reminder at ${times.map(L.fmt12).join(' & ')}` : ''}`);
    },
    goals(f, fd) {
      const p = me();
      p.name = fd.get('name').trim() || p.name;
      for (const k of ['cal', 'protein', 'water', 'glass', 'steps']) {
        const v = Math.round(+fd.get(k));
        if (v > 0) p.goals[k] = v;
      }
      save();
      render();
      toast('Saved');
      queuePublish(p); // friends see your new name
    },
    membership(f, fd) {
      const m = me().membership;
      m.end = fd.get('end');
      m.fee = fd.get('fee').trim();
      m.months = Math.max(1, Math.round(+fd.get('months')) || 1);
      m.warnDays = Math.max(0, Math.round(+fd.get('warnDays')) || 0);
      delete me().notified.keys.fee;
      save();
      render();
      toast('Membership saved');
    },
    'water-rem'(f, fd) {
      const from = fd.get('from');
      const to = fd.get('to');
      if (L.hmToMin(to) <= L.hmToMin(from)) return toast('"Until" has to be later than "From".');
      Object.assign(me().waterRem, { on: fd.get('on') === 'on', every: Math.max(15, Math.round(+fd.get('every')) || 60), from, to });
      save();
      render();
      toast('Water reminders saved');
    },
    'ex-cfg'(f, fd) {
      const repMin = Math.round(+fd.get('repMin'));
      const repMax = Math.round(+fd.get('repMax'));
      const inc = L.round2(+fd.get('inc'));
      if (!(repMin > 0) || repMax < repMin || inc < 0) return toast('Max reps must be at least min reps.');
      me().exCfg[f.dataset.ex] = { repMin, repMax, inc };
      save();
      closeSheet();
      render();
    },
    'custom-ex'(f, fd) {
      const name = fd.get('name').trim();
      if (!name) return;
      const fields = L.FIELDS.includes(fd.get('fields')) ? fd.get('fields') : 'wr';
      const ex = { id: 'c-' + uid(), name, group: fd.get('group'), fields, inc: 2.5, repMin: 8, repMax: 12 };
      me().customEx.push(ex);
      addExercise(ex.id);
    },
    'steps-manual'(f, fd) {
      const p = me();
      const n = Math.round(+fd.get('steps'));
      const rec = p.steps[today()] || (p.steps[today()] = {});
      if (n > 0) rec.manual = n;
      else delete rec.manual;
      save();
      closeSheet();
      render();
      toast(n > 0 ? `⌚ ${fmtInt(n)} steps saved for today` : 'Watch steps cleared');
    },
    async 'friend-add'(f, fd) {
      const p = me();
      const code = L.normalizeSyncCode(fd.get('code'));
      if (!code) return toast('That code doesn\'t look right. It\'s 12 letters and numbers, like 7K3P-9QXM-4D2A.');
      if (code === p.friendCode) return toast('That\'s your own code. Ask your friend for theirs.');
      if (p.friends.some((x) => x.code === code)) return toast('Already in your friends.');
      p.friends.push({ code, name: 'New friend', status: null, fetchedAt: 0 });
      save();
      refreshFriendsUI();
      ui.friendsAt = 0;
      await pollFriends();
      const added = me().friends.find((x) => x.code === code);
      toast(added?.status ? `👋 Added ${esc(added.name)}` : 'Added. Their name and streak show up once they open the app.');
    },
  };

  document.addEventListener('click', (e) => {
    if (e.target.id === 'sheet') return closeSheet();
    const el = e.target.closest('[data-action]');
    if (el && ACTIONS[el.dataset.action]) ACTIONS[el.dataset.action](el, e);
  });

  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    FORMS[f.dataset.form]?.(f, new FormData(f));
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    const form = t.form?.dataset.form;
    if (t.id === 'ex-search') {
      $('#ex-list').innerHTML = pickListHtml(me(), t.value);
    } else if (t.id === 'food-search') {
      $('#food-list').innerHTML = foodListHtml(t.value);
    } else if (t.id === 'supp-search') {
      $('#supp-list').innerHTML = suppListHtml(me(), t.value);
    } else if (form === 'set' && t.name === 'w') {
      const p = me();
      const entry = p.workouts.find((w) => w.id === t.form.dataset.id);
      // The live "at this weight last time" hint is for weight × reps exercises only.
      if (entry && fieldsOf(exById(p, entry.exId)) === 'wr') document.getElementById(`hint-${entry.id}`).innerHTML = weightHint(p, entry, t.value);
    } else if (form === 'meal' && t.name === 'name') {
      // Picking a previously logged food fills in its calories and protein.
      const f = t.form;
      const food = ui.foods.find((x) => x.name.toLowerCase() === t.value.trim().toLowerCase());
      if (food) {
        f.elements.cal.value = food.cal;
        f.elements.protein.value = food.protein;
        f.dataset.auto = '1';
      } else if (f.dataset.auto) {
        f.elements.cal.value = f.elements.protein.value = '';
        delete f.dataset.auto;
      }
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-import]')) {
      importFile(e.target);
    } else if (e.target.matches('[data-time]')) {
      // Tidy number-pad entry: "405" → "4:05".
      const sec = L.parseDur(e.target.value);
      if (sec) e.target.value = L.fmtDur(sec);
    } else if (e.target.matches('[data-pref="lead"]')) {
      const p = me();
      p.lead = e.target.checked;
      ensureFriendCode(p);
      save();
      publishNow(true);
      refreshFriendsUI();
      toast(p.lead ? '👑 You lead. Friends can now sync the exercises you add.' : 'You stopped leading workouts.');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet();
  });

  // Hide the bottom tabs while the on-screen keyboard is up.
  const isTextField = (el) => el.matches('input:not([type="checkbox"]):not([type="file"]), select');
  document.addEventListener('focusin', (e) => {
    if (isTextField(e.target)) document.body.classList.add('typing');
  });
  document.addEventListener('focusout', () => {
    setTimeout(() => { if (!isTyping()) document.body.classList.remove('typing'); }, 50);
  });

  // Another tab changed the data: reload it.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORE_KEY) return;
    db = loadDb();
    if (!isTyping()) render();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      ui.hiddenAt = Date.now();
      if (pedo.on || hrm.status !== 'off') save(); // steps and heart rate are saved in batches
      stopLive();
      return;
    }
    if (ui.hiddenAt && Date.now() - ui.hiddenAt > AUTO_LOCK_MS) ui.unlocked.clear();
    checkReminders();
    syncTick();
    // App: catch up on steps taken while it was closed, then count live again.
    refreshHealth();
    startLive();
    queueNativeReminders();
    if (!isTyping() && $('#sheet').hidden) render();
    else updateWakeLock();
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvt = e;
    if (ui.tab === 'today' && !isTyping()) render();
  });
  window.addEventListener('appinstalled', () => {
    installEvt = null;
    render();
  });

  window.addEventListener('online', syncTick);

  render();
  checkReminders();
  syncTick();
  initNative();
  setInterval(() => {
    checkReminders();
    syncTick();
    if (!document.hidden) refreshHealth();
  }, 30000);
  // The app ships its files inside the APK, so only the website needs the offline cache.
  if (!GymNative.isNative && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
