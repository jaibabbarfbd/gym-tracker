/* Friends: each phone posts a small status (name, streak and, when leading, the day's
   exercise list) through ntfy.sh, a free no-signup message relay, on a topic named after
   the person's random friend code. No sets, meals or other data travel. Messages expire
   after 12 hours, so phones re-post while the app is open. */
(function (root) {
  'use strict';
  const RELAY = 'https://ntfy.sh';
  const L = root.GymLogic;
  const timeout = () => (AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined);

  async function publish(code, payload) {
    const res = await fetch(`${RELAY}/${L.syncTopic(code)}`, { method: 'POST', body: JSON.stringify(payload), signal: timeout() });
    if (!res.ok) throw new Error(`Relay answered ${res.status}`);
  }

  // A friend's most recent status, or null if nothing was posted in the last 12 hours.
  async function fetchLatest(code) {
    const res = await fetch(`${RELAY}/${L.syncTopic(code)}/json?poll=1&since=12h`, { cache: 'no-store', signal: timeout() });
    if (!res.ok) throw new Error(`Relay answered ${res.status}`);
    let latest = null;
    for (const line of (await res.text()).split('\n')) {
      let msg;
      try { msg = JSON.parse(line); } catch (e) { continue; }
      const status = msg.event === 'message' ? L.parseStatus(msg.message) : null;
      if (status) latest = status;
    }
    return latest;
  }

  root.GymSync = { publish, fetchLatest };
})(window);
