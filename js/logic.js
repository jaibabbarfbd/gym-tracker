/* Pure logic: dates, nutrition totals, progressive overload, reminders, calendar export.
   No DOM access, so it also runs under Node for quick checks. */
(function (root) {
  'use strict';

  const DATA = root.GymData || require('./data.js');
  const { GROUPS, EXERCISES, FIELDS } = DATA;
  const DAY_TYPES = ['rest', 'strength', 'hybrid'];

  // ---------- Dates ----------
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');

  const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function parseYmd(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(s, n) {
    const d = parseYmd(s);
    d.setDate(d.getDate() + n);
    return ymd(d);
  }
  // Keeps the day of month where possible (31 Jan + 1 month = 28/29 Feb).
  function addMonths(s, n) {
    const d = parseYmd(s);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return ymd(d);
  }
  const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
  function hmToMin(hm) {
    const [h, m] = hm.split(':').map(Number);
    return h * 60 + m;
  }
  function atTime(hm, now) {
    const d = new Date(now);
    const [h, m] = hm.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }

  function fmtDate(s) {
    const d = parseYmd(s);
    return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }
  function relDay(s, from) {
    const n = daysBetween(s, from);
    if (n === 0) return 'today';
    if (n === 1) return 'yesterday';
    if (n === -1) return 'tomorrow';
    if (n < 0) return `in ${-n} days`;
    if (n < 14) return `${n} days ago`;
    return `${Math.round(n / 7)} weeks ago`;
  }
  const fmtClock = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmt12 = (hm) => fmtClock(atTime(hm, Date.now()));
  const round2 = (n) => Math.round(n * 100) / 100;
  const fmtW = (w) => String(round2(w));
  // 245 → "4:05", 3725 → "1:02:05"
  function fmtDur(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  }
  // Accepts "4:05", "1:02:05" or digits typed on a number pad ("405" → 4:05). Returns seconds or null.
  function parseDur(input) {
    const str = String(input ?? '').trim();
    let parts;
    if (/^\d{1,2}$/.test(str)) parts = [str]; // plain seconds
    else if (/^\d{3,6}$/.test(str)) {
      const d = str.padStart(6, '0'); // number pad: hhmmss, right-aligned
      parts = [d.slice(0, 2), d.slice(2, 4), d.slice(4)];
    } else if (/^\d+(:\d{1,2}){1,2}$/.test(str)) parts = str.split(':');
    else return null;
    const nums = parts.map(Number);
    if (nums.length > 1 && nums.slice(1).some((n) => n > 59)) return null;
    const sec = nums.reduce((total, n) => total * 60 + n, 0);
    return sec > 0 ? sec : null;
  }
  const fmtL = (ml) => String(round2(ml / 1000));

  // ---------- Nutrition ----------
  function dayTotals(meals, date) {
    return meals
      .filter((m) => m.date === date)
      .reduce((t, m) => ({ cal: t.cal + (+m.cal || 0), protein: round2(t.protein + (+m.protein || 0)) }), { cal: 0, protein: 0 });
  }

  // Most-logged foods first, carrying the most recently entered calories/protein.
  function savedFoods(meals, limit = 12) {
    const map = new Map();
    for (const m of meals) {
      const key = m.name.trim().toLowerCase();
      const count = (map.get(key)?.count || 0) + 1;
      map.set(key, { name: m.name.trim(), cal: m.cal, protein: m.protein, count });
    }
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  }

  // ---------- Training ----------
  function exerciseCfg(ex, override) {
    const o = override || {};
    return {
      fields: FIELDS.includes(ex.fields) ? ex.fields : 'wr',
      repMin: o.repMin ?? ex.repMin ?? 8,
      repMax: o.repMax ?? ex.repMax ?? 12,
      inc: o.inc ?? ex.inc ?? 2.5,
    };
  }
  // "For time" work (distance, reps or carries): less time is better.
  const isForTime = (fields) => fields !== 't' && fields.includes('t');
  // Seconds per metre / per rep, so different amounts of work can still be compared.
  const pace = (s) => s.t / ((s.d || 0) + (s.r || 0) || 1);

  // Most recent session of an exercise strictly before `date`.
  function lastSession(workouts, exId, date) {
    let best = null;
    for (const w of workouts) {
      if (w.exId !== exId || w.date >= date || !w.sets.length) continue;
      if (!best || w.date > best.date || (w.date === best.date && w.ts > best.ts)) best = w;
    }
    return best;
  }

  // Set-by-set goals from last session.
  //   Lifts (double progression): +1 rep; once a set reaches the top of the rep range,
  //   add weight and drop back to the bottom.
  //   For time: same work about 2% faster (1–30 s). Holds: about 5% longer (at least 5 s).
  function overloadTargets(last, cfg) {
    if (!last) return [];
    const fields = cfg.fields || 'wr';
    return last.sets.map((s) => {
      if (fields === 't') return { t: s.t + Math.max(5, Math.round(s.t * 0.05)), up: false };
      if (isForTime(fields)) return { ...s, t: Math.max(1, s.t - Math.min(30, Math.max(1, Math.round(s.t * 0.02)))), up: false };
      if (s.w > 0 && cfg.inc > 0 && s.r >= cfg.repMax) return { w: round2(s.w + cfg.inc), r: cfg.repMin, up: true };
      return { w: s.w, r: s.r + 1, up: false };
    });
  }

  // The day's standout set: fastest pace, longest hold, or highest estimated 1RM.
  function bestSet(sets, fields = 'wr') {
    return sets.reduce((a, b) => {
      if (fields === 't') return b.t > a.t ? b : a;
      if (isForTime(fields)) return pace(b) < pace(a) ? b : a;
      return e1rm(b.w, b.r) > e1rm(a.w, a.r) || (b.w === a.w && b.r > a.r) ? b : a;
    });
  }

  // All-time best timed set before `date` (fastest pace, or longest hold).
  function bestTimed(workouts, exId, fields, date) {
    let best = null;
    for (const s of workouts) {
      if (s.exId !== exId || s.date >= date) continue;
      for (const set of s.sets) {
        if (!(set.t > 0)) continue;
        const better = !best || (fields === 't' ? set.t > best.set.t : pace(set) < pace(best.set));
        if (better) best = { set, date: s.date };
      }
    }
    return best;
  }

  // Reps done at exactly this weight before `date`: every set from the most recent
  // session that used it, plus the all-time best.
  function repsAtWeight(workouts, exId, w, date) {
    let last = null;
    let best = null;
    for (const s of workouts) {
      if (s.exId !== exId || s.date >= date) continue;
      const reps = s.sets.filter((set) => set.w === w).map((set) => set.r);
      if (!reps.length) continue;
      if (!last || s.date > last.date || (s.date === last.date && s.ts > last.ts)) last = { date: s.date, ts: s.ts, reps };
      const top = Math.max(...reps);
      if (!best || top > best.r) best = { date: s.date, r: top };
    }
    return { last, best };
  }

  // Epley estimated one-rep max.
  const e1rm = (w, r) => (w > 0 ? round2(w * (1 + r / 30)) : 0);

  function personalBests(workouts, exId) {
    let heaviest = null;
    let best1rm = null;
    let mostReps = null;
    for (const s of workouts) {
      if (s.exId !== exId) continue;
      for (const set of s.sets) {
        if (!heaviest || set.w > heaviest.w || (set.w === heaviest.w && set.r > heaviest.r)) heaviest = { ...set, date: s.date };
        const v = e1rm(set.w, set.r);
        if (v && (!best1rm || v > best1rm.v)) best1rm = { ...set, v, date: s.date };
        if (!mostReps || set.r > mostReps.r) mostReps = { ...set, date: s.date };
      }
    }
    return { heaviest, best1rm, mostReps };
  }

  // Lifts: same weight compares reps, different weight compares estimated 1RM.
  // For time: compares pace. Holds: compares time.
  function compareSet(set, target, fields = 'wr') {
    if (!target) return null;
    if (fields === 't') return set.t > target.t ? 'beat' : set.t === target.t ? 'hit' : 'miss';
    if (isForTime(fields)) {
      const a = pace(set);
      const b = pace(target);
      return a < b ? 'beat' : a === b ? 'hit' : 'miss';
    }
    const same = set.w === target.w;
    const a = same ? set.r : e1rm(set.w, set.r) || set.r;
    const b = same ? target.r : e1rm(target.w, target.r) || target.r;
    return a > b ? 'beat' : a === b ? 'hit' : 'miss';
  }

  // ---------- Progress series (for charts) ----------
  // One point per session: a lift's best estimated 1RM (reps for bodyweight), a timed exercise's
  // best time, or a hold's longest time.
  function liftSeries(workouts, exId, fields = 'wr') {
    const byDate = new Map();
    for (const w of workouts) {
      if (w.exId !== exId || !w.sets.length) continue;
      const best = bestSet(w.sets, fields);
      let y;
      if (fields === 'wr') y = best.w > 0 ? e1rm(best.w, best.r) : best.r;
      else y = best.t;
      const prev = byDate.get(w.date);
      const better = prev == null || (isForTime(fields) ? y < prev : y > prev);
      if (better) byDate.set(w.date, y);
    }
    return [...byDate].sort((a, b) => a[0].localeCompare(b[0])).map(([x, y]) => ({ x, y }));
  }

  // Monday of the week containing `date`.
  function weekStart(date) {
    const d = parseYmd(date);
    return addDays(date, -((d.getDay() + 6) % 7));
  }

  // Total weight lifted (kg × reps over weighted sets) for each of the last `weeks` weeks, oldest first.
  function weeklyVolume(workouts, today, weeks = 8) {
    const first = addDays(weekStart(today), -7 * (weeks - 1));
    const out = Array.from({ length: weeks }, (_, i) => ({ x: addDays(first, 7 * i), y: 0 }));
    for (const w of workouts) {
      if (w.date < first || w.date > today) continue;
      const i = Math.floor(daysBetween(first, w.date) / 7);
      for (const s of w.sets) if (s.w > 0 && s.r > 0) out[i].y += s.w * s.r;
    }
    out.forEach((p) => { p.y = Math.round(p.y); });
    return out;
  }

  // One value per day for the last `days` days, oldest first.
  function dailySeries(days, today, valueOf) {
    return Array.from({ length: days }, (_, i) => {
      const x = addDays(today, i - days + 1);
      return { x, y: round2(valueOf(x) || 0) };
    });
  }

  // Body log: one entry per date, newest values win. Returns [{ x, y }] for one measurement.
  function bodySeries(body, key) {
    return body.filter((b) => b[key] > 0).sort((a, b) => a.date.localeCompare(b.date)).map((b) => ({ x: b.date, y: b[key] }));
  }

  // Change in a measurement over the last `days` days (latest minus the last value on or before the start).
  function bodyChange(body, key, today, days) {
    const series = bodySeries(body, key);
    if (series.length < 2) return null;
    const latest = series[series.length - 1];
    const startDate = addDays(today, -days);
    const before = [...series].reverse().find((p) => p.x <= startDate) || series[0];
    if (before === latest) return null;
    return { change: round2(latest.y - before.y), from: before.x };
  }

  // ---------- Streaks ----------
  // A day counts when a workout set was logged or the day was marked as a rest day.
  // The streak runs back from today, or from yesterday so it isn't lost before today's session.
  function streakInfo(workouts, days, today) {
    const active = new Set(workouts.filter((w) => w.sets.length && w.date <= today).map((w) => w.date));
    for (const [d, type] of Object.entries(days || {})) if (type === 'rest' && d <= today) active.add(d);
    const last = [...active].sort().pop() || null;
    let day = active.has(today) ? today : addDays(today, -1);
    let count = 0;
    while (active.has(day)) {
      count++;
      day = addDays(day, -1);
    }
    return { count, last };
  }

  // A friend's streak as of today: it only survives if they were active today or yesterday.
  const streakNow = (status, today) => (status?.last && daysBetween(status.last, today) <= 1 ? status.streak || 0 : 0);

  // ---------- Steps & heart rate ----------
  // Step detector for accelerometer samples (m/s², ms). Steps are peaks in the
  // movement around gravity. They only count once a rhythm of `warmup` steps
  // 0.25–2 s apart shows up, so a single shake or bump adds nothing.
  function createStepDetector({ threshold = 1.1, minGap = 250, maxGap = 2000, warmup = 4 } = {}) {
    let gravity = null;
    let wave = 0;
    let armed = true;
    let lastStep = 0;
    let pending = 0;
    let walking = false;
    return function push(x, y, z, t) {
      const mag = Math.sqrt(x * x + y * y + z * z);
      gravity = gravity == null ? mag : gravity * 0.98 + mag * 0.02;
      wave = wave * 0.6 + (mag - gravity) * 0.4;
      if (!armed) {
        if (wave < threshold * 0.4) armed = true;
        return 0;
      }
      if (wave < threshold) return 0;
      armed = false;
      const gap = t - lastStep;
      if (lastStep && gap < minGap) return 0;
      lastStep = t;
      if (gap > maxGap) { // first step, or walking again after a pause
        walking = false;
        pending = 1;
        return 0;
      }
      if (walking) return 1;
      if (++pending < warmup) return 0;
      walking = true;
      const n = pending;
      pending = 0;
      return n;
    };
  }

  // Bluetooth Heart Rate Measurement (0x2A37): a flags byte, then bpm as uint8 or uint16.
  const parseHeartRate = (view) => (view.getUint8(0) & 1 ? view.getUint16(1, true) : view.getUint8(1));

  // Every source (phone motion, watch typed in, Health Connect, live while open) counts the same
  // steps, so the day's total is whichever is highest, never the sum.
  const stepsTotal = (rec) => Math.max(rec?.phone || 0, rec?.manual || 0, rec?.health || 0, rec?.live || 0);

  // ---------- Reminders ----------
  // Next "drink water" nudge: `every` minutes after the latest of the last drink,
  // the last nudge, or the start of today's window.
  function waterReminder(rem, lastDrinkTs, lastNudgeTs, now) {
    if (!rem || !rem.on) return { due: false, next: null };
    const start = atTime(rem.from, now);
    const end = atTime(rem.to, now);
    if (now > end) return { due: false, next: null };
    const next = Math.max(lastDrinkTs || 0, lastNudgeTs || 0, start) + rem.every * 60000;
    if (next > end) return { due: false, next: null };
    return { due: now >= next, next };
  }

  // One row per supplement per scheduled time; supplements without a time get one "any time" row.
  function suppSlots(supps) {
    return supps
      .flatMap((supp) => (supp.times.length ? [...supp.times].sort().map((slot) => ({ supp, slot })) : [{ supp, slot: '' }]))
      .sort((a, b) => (a.slot || '99').localeCompare(b.slot || '99'));
  }
  const findTaken = (log, suppId, slot, date) => log.find((l) => l.suppId === suppId && l.slot === slot && l.date === date);

  function membershipStatus(m, today) {
    if (!m || !m.end) return { state: 'none', daysLeft: null };
    const daysLeft = daysBetween(today, m.end);
    const state = daysLeft < 0 ? 'expired' : daysLeft <= (m.warnDays ?? 3) ? 'due' : 'ok';
    return { state, daysLeft };
  }

  // ---------- Profile passwords ----------
  // Pure-JS SHA-256 so it also works where crypto.subtle is missing (plain-http LAN).
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  function sha256Hex(msg) {
    const bytes = new TextEncoder().encode(msg);
    const len = bytes.length;
    const words = new Uint32Array(((len + 72) >> 6) << 4);
    for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
    words[len >> 2] |= 0x80 << (24 - (len & 3) * 8);
    words[words.length - 1] = len * 8;
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const W = new Uint32Array(64);
    for (let blk = 0; blk < words.length; blk += 16) {
      for (let t = 0; t < 16; t++) W[t] = words[blk + t];
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + W[t]) | 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
    }
    return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  // Salted and stretched so the stored hash isn't a quick lookup.
  function hashPassword(pw, salt) {
    let h = sha256Hex(`${salt}:${pw}`);
    for (let i = 0; i < 2000; i++) h = sha256Hex(h + pw);
    return h;
  }
  function randomBytes(n) {
    const bytes = new Uint8Array(n);
    if (root.crypto?.getRandomValues) root.crypto.getRandomValues(bytes);
    else bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
    return bytes;
  }
  function makePassword(pw) {
    const salt = Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
    return { salt, hash: hashPassword(pw, salt) };
  }
  const checkPassword = (pw, pass) => !!pass && hashPassword(String(pw ?? ''), pass.salt) === pass.hash;

  // ---------- Phone-to-phone workout sync ----------
  // No 0/O, 1/I/L, so codes survive being read out or typed from a screenshot.
  const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const formatCode = (s) => `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
  const newSyncCode = () => formatCode(Array.from(randomBytes(12), (b) => CODE_CHARS[b % CODE_CHARS.length]).join(''));

  // Accepts loosely typed codes ("7k3p 9qxm4d2a") and returns the canonical form, or null.
  function normalizeSyncCode(input) {
    const s = String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    return s.length === 12 && [...s].every((c) => CODE_CHARS.includes(c)) ? formatCode(s) : null;
  }
  const syncTopic = (code) => `gymbros-${code.replace(/-/g, '').toLowerCase()}`;

  // What the leader's phone sends: the day type and exercise list. Names travel only for custom exercises.
  function workoutPayload(name, date, type, entries, customEx) {
    const ex = entries.map((e) => {
      const c = customEx.find((x) => x.id === e.exId);
      return c ? [c.id, c.name, c.group, c.fields || 'wr'] : [e.exId];
    });
    return { v: 1, by: name, date, type: type || null, ts: Date.now(), ex };
  }

  // Payloads come from the network, so anything malformed or unknown is dropped.
  function parseWorkoutPayload(raw) {
    let d = raw;
    if (typeof d === 'string') {
      try { d = JSON.parse(d); } catch (e) { return null; }
    }
    if (!d || d.v !== 1 || typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !Array.isArray(d.ex)) return null;
    const known = new Set(EXERCISES.map((e) => e.id));
    const seen = new Set();
    const ex = [];
    for (const a of d.ex.slice(0, 40)) {
      if (!Array.isArray(a) || typeof a[0] !== 'string' || !/^[a-z0-9-]{1,40}$/i.test(a[0]) || seen.has(a[0])) continue;
      if (known.has(a[0])) ex.push({ id: a[0] });
      else if (a[0].startsWith('c-') && typeof a[1] === 'string' && a[1].trim()) {
        ex.push({ id: a[0], name: a[1].trim().slice(0, 40), group: GROUPS.includes(a[2]) ? a[2] : 'Core', fields: FIELDS.includes(a[3]) ? a[3] : 'wr' });
      } else continue;
      seen.add(a[0]);
    }
    const type = DAY_TYPES.includes(d.type) ? d.type : null;
    return { by: String(d.by || 'Your friend').slice(0, 24), date: d.date, type, ts: +d.ts || 0, ex };
  }

  // What each phone shares with friends: name and streak, plus the day's workout when leading.
  function statusPayload({ name, streak, lead, workout }) {
    const w = lead && workout ? { date: workout.date, type: workout.type, ex: workout.ex } : null;
    return { v: 2, by: name, ts: Date.now(), streak: streak.count, last: streak.last, lead: !!lead, w };
  }

  // Also accepts the older workout-only messages (v1) from phones linked before friends existed.
  function parseStatus(raw) {
    let d = raw;
    if (typeof d === 'string') {
      try { d = JSON.parse(d); } catch (e) { return null; }
    }
    if (d?.v === 1) {
      const w = parseWorkoutPayload(d);
      return w && { by: w.by, ts: w.ts, streak: 0, last: null, lead: true, w };
    }
    if (!d || d.v !== 2) return null;
    const by = String(d.by || 'Your friend').slice(0, 24);
    const w = d.w && typeof d.w === 'object' ? parseWorkoutPayload({ v: 1, by, date: d.w.date, type: d.w.type, ts: d.ts, ex: d.w.ex }) : null;
    return {
      by,
      ts: +d.ts || 0,
      streak: Number.isInteger(d.streak) && d.streak >= 0 && d.streak < 100000 ? d.streak : 0,
      last: typeof d.last === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.last) ? d.last : null,
      lead: !!d.lead,
      w,
    };
  }

  // Android notifications to schedule (app): water every day, each supplement dose for the next
  // 7 days (skipping doses already ticked off today), and the gym-fee dates. `at` is in ms.
  function nativeReminders(p, now) {
    const out = [];
    const t = ymd(new Date(now));
    const r = p.waterRem;
    if (r.on) {
      const end = hmToMin(r.to);
      for (let m = hmToMin(r.from) + r.every, i = 0; m <= end && i < 40; m += r.every, i++) {
        out.push({ id: 1000 + i, title: 'Drink water 💧', body: `Daily goal: ${fmtL(p.goals.water)} L`, hour: Math.floor(m / 60), minute: m % 60 });
      }
    }
    let id = 2000;
    for (const { supp, slot } of suppSlots(p.supps)) {
      if (!slot) continue;
      for (let d = 0; d < 7; d++) {
        const date = addDays(t, d);
        const at = atTime(slot, parseYmd(date).getTime());
        if (at <= now || (d === 0 && findTaken(p.suppLog, supp.id, slot, date))) continue;
        out.push({ id: id++, title: `Take your ${supp.name} 💊`, body: supp.dose ? `${supp.dose} · ${fmt12(slot)}` : fmt12(slot), at });
      }
    }
    const m = p.membership;
    if (m.end) {
      const nine = (date) => atTime('09:00', parseYmd(date).getTime());
      const warn = addDays(m.end, -(m.warnDays ?? 3));
      const fee = m.fee ? ` Fee: ${m.fee}.` : '';
      if (warn < m.end && nine(warn) > now) out.push({ id: 3000, title: 'Gym fees due soon 💳', body: `Membership ends ${fmtDate(m.end)}.${fee}`, at: nine(warn) });
      if (nine(m.end) > now) out.push({ id: 3001, title: 'Gym membership ends today 💳', body: `Time to pay your gym fees.${fee}`, at: nine(m.end) });
    }
    return out;
  }

  // ---------- Calendar export ----------
  const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  function icsFold(line) {
    if (line.length <= 74) return line;
    const parts = [];
    for (let i = 0; i < line.length; i += 73) parts.push((i ? ' ' : '') + line.slice(i, i + 73));
    return parts.join('\r\n');
  }

  // Phone calendars fire these alarms even when the app is closed.
  function buildICS(p, today, now = new Date()) {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gym Tracker//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Gym Tracker reminders'];
    const dt = (date, min) => {
      const d = parseYmd(date);
      d.setMinutes(min);
      return `${ymd(d).replace(/-/g, '')}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    };
    let count = 0;
    const event = (key, date, min, title, desc, daily) => {
      count++;
      out.push('BEGIN:VEVENT', `UID:gymbros-${p.id}-${key}@gymbros`, `DTSTAMP:${stamp}`, `DTSTART:${dt(date, min)}`, `DTEND:${dt(date, min + 10)}`, `SUMMARY:${icsText(title)}`);
      if (desc) out.push(`DESCRIPTION:${icsText(desc)}`);
      if (daily) out.push('RRULE:FREQ=DAILY');
      out.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(title)}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT');
    };

    const r = p.waterRem;
    if (r.on) {
      const end = hmToMin(r.to);
      for (let m = hmToMin(r.from) + r.every, i = 0; m <= end && i < 24; m += r.every, i++) {
        event(`water-${m}`, today, m, 'Drink water', `Daily goal: ${fmtL(p.goals.water)} L`, true);
      }
    }
    for (const { supp, slot } of suppSlots(p.supps)) {
      if (slot) event(`supp-${supp.id}-${slot}`, today, hmToMin(slot), `Take ${supp.name}`, supp.dose, true);
    }
    const ms = p.membership;
    if (ms.end && ms.end >= today) {
      const fee = ms.fee ? ` (fee ${ms.fee})` : '';
      const warn = addDays(ms.end, -(ms.warnDays ?? 3));
      if (warn > today && warn < ms.end) event(`fee-warn-${ms.end}`, warn, 9 * 60, `Gym fees due in ${ms.warnDays} days`, `Membership ends ${fmtDate(ms.end)}${fee}`);
      event(`fee-end-${ms.end}`, ms.end, 9 * 60, 'Gym membership expires today', `Pay your gym fees${fee}`);
    }
    out.push('END:VCALENDAR');
    return { ics: out.map(icsFold).join('\r\n') + '\r\n', count };
  }

  const api = {
    ...DATA, DAY_TYPES,
    ymd, parseYmd, addDays, addMonths, daysBetween, hmToMin, atTime, fmtDate, relDay, fmtClock, fmt12, fmtW, fmtL, fmtDur, parseDur, round2,
    dayTotals, savedFoods,
    exerciseCfg, isForTime, lastSession, overloadTargets, bestSet, bestTimed, repsAtWeight, e1rm, personalBests, compareSet,
    createStepDetector, parseHeartRate, stepsTotal, nativeReminders,
    waterReminder, suppSlots, findTaken, membershipStatus, buildICS,
    sha256Hex, makePassword, checkPassword,
    newSyncCode, normalizeSyncCode, syncTopic, workoutPayload, parseWorkoutPayload, statusPayload, parseStatus,
    streakInfo, streakNow,
    liftSeries, weekStart, weeklyVolume, dailySeries, bodySeries, bodyChange,
  };
  root.GymLogic = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
