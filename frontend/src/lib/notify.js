const HAS_NOTIFICATIONS = typeof window !== 'undefined' && 'Notification' in window;

export async function requestNotificationPermission() {
  if (!HAS_NOTIFICATIONS) return 'unsupported';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

// best-effort only -- iOS Safari has no Vibration API at all, desktop
// browsers just silently ignore the call. never worth throwing over.
export function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // ignore
  }
}

// races serviceWorker.ready against a short timeout instead of awaiting it
// directly -- if no service worker is registered at all (e.g. local dev,
// where the pwa plugin's SW is off) that promise never resolves.
async function readyServiceWorker(timeoutMs = 1500) {
  if (!('serviceWorker' in navigator)) return null;
  return Promise.race([
    navigator.serviceWorker.ready.catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

// fires a native OS notification, but only when there's a reason to: the
// user wouldn't otherwise see this (tab backgrounded / window unfocused)
// and they've actually granted permission. Routed through the installed
// PWA's service worker when one's active -- the only way iOS will show it
// at all, since Safari never implemented the plain Notification()
// constructor for installed PWAs -- with a same-tab fallback for local dev.
export async function notifyIfAway(title, options = {}) {
  if (!HAS_NOTIFICATIONS || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  try {
    const reg = await readyServiceWorker();
    if (reg) {
      await reg.showNotification(title, options);
    } else {
      new Notification(title, options);
    }
  } catch {
    // never worth surfacing an error over a missed native notification
  }
}
