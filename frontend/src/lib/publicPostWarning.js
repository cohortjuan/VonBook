const DISMISS_KEY = 'vonbook_public_warning_dismissed';

export function publicWarningDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === 'true';
  } catch {
    return false;
  }
}

export function dismissPublicWarning() {
  try {
    localStorage.setItem(DISMISS_KEY, 'true');
  } catch {
    // private browsing / storage disabled -- worst case the warning just
    // shows again next time, not worth surfacing an error over
  }
}
