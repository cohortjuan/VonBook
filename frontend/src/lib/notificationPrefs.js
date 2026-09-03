// per-device (localStorage, not per-account -- same tradeoff as
// lib/publicPostWarning.js) toggles for which native-notification/
// vibration categories are actually allowed to fire. this is layered on
// top of the browser's own notification permission (see lib/notify.js) --
// turning a category off here stops the vibration + native popup for it
// even if the browser permission is granted; the in-app bell/badge still
// updates regardless, this only controls the buzz.
const KEY = 'vonbook_notification_prefs';
const DEFAULTS = { calls: true, messages: true, reports: true };

export function getNotificationPrefs() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY));
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setNotificationPref(category, enabled) {
  const prefs = getNotificationPrefs();
  prefs[category] = enabled;
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // ignore -- private browsing / storage disabled just means the
    // preference doesn't persist, not worth surfacing an error over
  }
}
