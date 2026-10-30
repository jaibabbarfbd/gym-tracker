/* Android app extras (Capacitor). In a browser none of this is active and the web versions are used.
   - Steps: today's total from Health Connect, which keeps counting all day with the app closed.
   - Reminders: scheduled as Android notifications, so they fire with the app closed.
   - Files and text go out through the Android share sheet. */
(function (root) {
  'use strict';
  const cap = root.Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const plugin = (name) => (isNative ? (cap.Plugins && cap.Plugins[name]) || (cap.registerPlugin && cap.registerPlugin(name)) : null);
  const Health = plugin('Health');
  const Notifs = plugin('LocalNotifications');
  const Share = plugin('Share');
  const Files = plugin('Filesystem');

  // ---------- Steps (Health Connect) ----------
  // 'granted' | 'not-granted' | 'unavailable' (Health Connect missing or outdated) | 'unsupported' (browser)
  async function stepsAccess() {
    if (!Health) return 'unsupported';
    try {
      const { available } = await Health.isAvailable();
      if (!available) return 'unavailable';
      const status = await Health.checkAuthorization({ read: ['steps'] });
      return (status.readAuthorized || []).includes('steps') ? 'granted' : 'not-granted';
    } catch (e) {
      return 'unavailable';
    }
  }

  async function requestSteps() {
    if (!Health) return 'unsupported';
    try {
      const status = await Health.requestAuthorization({ read: ['steps'] });
      return (status.readAuthorized || []).includes('steps') ? 'granted' : 'not-granted';
    } catch (e) {
      return 'unavailable';
    }
  }

  // Today's steps from every source Health Connect knows (phone, Google Fit, Samsung Health, watches).
  async function stepsToday() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const { samples } = await Health.queryAggregated({
      dataType: 'steps',
      startDate: start.toISOString(),
      endDate: new Date().toISOString(),
      bucket: 'day',
      aggregation: 'sum',
    });
    return Math.round((samples || []).reduce((sum, s) => sum + (s.value || 0), 0));
  }

  const openHealthSettings = () => Health && Health.openHealthConnectSettings();

  // ---------- Reminders ----------
  // Reminder ids live in this range; other notifications (the rest timer) are left alone.
  const REMINDER_IDS = [1000, 899999];

  async function notifPermission(request) {
    if (!Notifs) return 'unsupported';
    try {
      let s = await Notifs.checkPermissions();
      if (s.display !== 'granted' && request) s = await Notifs.requestPermissions();
      return s.display;
    } catch (e) {
      return 'denied';
    }
  }

  // Replaces all scheduled reminders with `list`: { id, title, body } plus either `at` (Date, once)
  // or `hour` + `minute` (every day).
  async function setReminders(list) {
    if (!Notifs) return;
    const { notifications: pending } = await Notifs.getPending();
    const old = pending.filter((n) => n.id >= REMINDER_IDS[0] && n.id <= REMINDER_IDS[1]);
    if (old.length) await Notifs.cancel({ notifications: old.map((n) => ({ id: n.id })) });
    if (!list.length) return;
    await Notifs.schedule({
      notifications: list.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        schedule: r.at ? { at: r.at, allowWhileIdle: true } : { on: { hour: r.hour, minute: r.minute }, allowWhileIdle: true },
        isExactNotification: false, // no "Alarms & reminders" permission prompt; a minute or two of drift is fine
        autoCancel: true,
      })),
    });
  }

  // A one-off notification (e.g. the rest timer). Pass `at: null` to cancel it.
  async function notifyAt(id, title, body, at) {
    if (!Notifs) return;
    await Notifs.cancel({ notifications: [{ id }] });
    if (at) await Notifs.schedule({ notifications: [{ id, title, body, schedule: { at, allowWhileIdle: true }, isExactNotification: false, autoCancel: true }] });
  }

  // ---------- Sharing ----------
  async function shareFile(name, text) {
    const { uri } = await Files.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
    await Share.share({ title: name, files: [uri] });
  }
  const shareText = (text) => Share.share({ text });

  root.GymNative = { isNative, stepsAccess, requestSteps, stepsToday, openHealthSettings, notifPermission, setReminders, notifyAt, shareFile, shareText };
})(window);
