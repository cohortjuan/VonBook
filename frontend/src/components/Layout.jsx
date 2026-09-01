import { useCallback, useEffect, useState } from 'react';
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

  useEffect(() => {
    refreshUnread();
  }, [refreshUnread]);

  useEffect(() => {
    if (!socket) return;
    const onNotification = (n) => {
      setUnreadNotifications((c) => c + 1);
      if (n.type === 'message') setUnreadMessages((c) => c + 1);
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
      <main className="app-main">
        {children ?? <Outlet context={{ refreshUnread }} />}
      </main>
      <BottomNav unreadMessages={unreadMessages} />
      <IncomingCallModal />
      <CallOverlay />
      {confettiRun > 0 && <Confetti key={confettiRun} onDone={() => {}} />}
    </div>
  );
}
