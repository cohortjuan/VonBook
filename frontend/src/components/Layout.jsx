import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet } from 'react-router-dom';
import TopBar from './TopBar.jsx';
import BottomNav from './BottomNav.jsx';
import IncomingCallModal from './IncomingCallModal.jsx';
import CallOverlay from './CallOverlay.jsx';
import Confetti from './Confetti.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useKonamiCode } from '../hooks/useKonamiCode.js';
import { useFounderBirthday } from '../hooks/useFounderBirthday.js';
import { api } from '../api/client.js';
import { requestNotificationPermission, vibrate, notifyIfAway } from '../lib/notify.js';
import { NOTIFICATION_LABEL } from '../lib/notificationText.js';
import { getNotificationPrefs } from '../lib/notificationPrefs.js';

// only these are urgent enough to ever buzz the phone / pop a native
// notification for -- likes and comments would just be spammy noise on
// something this size (a birthday present for a few friends, not a feed
// people are glued to). 'report' only ever reaches a dev account (see
// is_dev on users, routes/posts.js). each maps to one of the toggles in
// Settings (see lib/notificationPrefs.js) -- missed_call rides on the
// same "calls" toggle as the live incoming-call ring in CallContext.jsx.
const BUZZ_TYPE_TO_PREF = { message: 'messages', missed_call: 'calls', report: 'reports' };

// used two ways: as a react-router layout route (renders its nested routes
// via Outlet, the normal case for every authenticated page) and, from
// HomeGate, wrapping Feed directly for a signed-in visitor landing on "/" --
// see HomeGate.jsx for why that path needs to decide between this and the
// public Landing page itself, rather than just always redirecting.
export default function Layout({ children }) {
  const { socket } = useSocket();
  const toast = useToast();
  const { founder, isBirthdayToday } = useFounderBirthday();
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [confettiRun, setConfettiRun] = useState(0);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const refreshUnread = useCallback(() => {
    api.notifications.unreadCount().then((r) => setUnreadNotifications(r.count)).catch(() => {});
    api.messages
      .conversations()
      .then((convos) => {
        const unread = convos.filter(
          (c) => c.last_message_at && c.last_message_sender_id !== null && (!c.last_read_at || new Date(c.last_message_at) > new Date(c.last_read_at)),
        ).length;
        setUnreadMessages(unread);
      })
      .catch(() => {});
  }, []);

  const outletContext = useMemo(() => ({ refreshUnread }), [refreshUnread]);

  useEffect(() => {
    refreshUnread();
  }, [refreshUnread]);

  // ask once per visit -- the browser only actually shows its own prompt
  // the first time; every call after a decision just resolves instantly
  // with whatever the user already chose.
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onNotification = (n) => {
      setUnreadNotifications((c) => c + 1);
      if (n.type === 'message') setUnreadMessages((c) => c + 1);
      const prefKey = BUZZ_TYPE_TO_PREF[n.type];
      if (prefKey && getNotificationPrefs()[prefKey]) {
        vibrate(80);
        notifyIfAway(n.actor_display_name || 'VonBook', {
          body: NOTIFICATION_LABEL[n.type]?.(n) || 'You have a new notification',
          tag: `vonbook-notification-${n.id}`,
        });
      }
    };
    socket.on('notification', onNotification);
    return () => socket.off('notification', onNotification);
  }, [socket]);

  // easter egg: konami code fires confetti anywhere in the app
  useKonamiCode(
    useCallback(() => {
      setConfettiRun((n) => n + 1);
      toast('You found the secret code! 🎮✨', 'success');
    }, [toast]),
  );

  // auto-confetti once per visit on the founder's actual birthday
  useEffect(() => {
    if (isBirthdayToday) setConfettiRun((n) => n + 1);
  }, [isBirthdayToday]);

  return (
    <div className="app-shell">
      {isBirthdayToday && founder && !bannerDismissed && (
        <div className="birthday-banner">
          🎉 It's {founder.display_name}'s birthday! Happy Birthday! 🎂
          <button className="birthday-banner-close" onClick={() => setBannerDismissed(true)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      <TopBar unreadNotifications={unreadNotifications} />
      {/* memoised: an inline object literal here is a new identity on every
          render, and Notifications keys an effect off this context -- so
          refreshing the unread count re-rendered Layout, which changed the
          context, which re-ran the effect, which refreshed the count again.
          It settled, but only after a wasted second round of API calls. */}
      <main className="app-main">{children ?? <Outlet context={outletContext} />}</main>
      <BottomNav unreadMessages={unreadMessages} />
      <IncomingCallModal />
      <CallOverlay />
      {confettiRun > 0 && <Confetti key={confettiRun} onDone={() => {}} />}
    </div>
  );
}
