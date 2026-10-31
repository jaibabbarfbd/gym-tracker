/* Android app extras (Capacitor). In a browser none of this is active and the web versions are used.
   - Reminders: scheduled as Android notifications, so they fire with the app closed.
   - Files and text go out through the Android share sheet. */
(function (root) {
  'use strict';
  const cap = root.Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !isNative;
  const isIosPwa = isIos && (navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches);
  const plugin = (name) => (isNative ? (cap.Plugins && cap.Plugins[name]) || (cap.registerPlugin && cap.registerPlugin(name)) : null);
  const Notifs = plugin('LocalNotifications');
  const Share = plugin('Share');
  const Files = plugin('Filesystem');

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

  root.GymNative = { isNative, isIos, isIosPwa, notifPermission, setReminders, notifyAt, shareFile, shareText };
})(window);
