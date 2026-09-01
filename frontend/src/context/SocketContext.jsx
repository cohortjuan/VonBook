import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext.jsx';
import { api } from '../api/client.js';

const SocketContext = createContext(null);

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

// one socket.io connection for the whole app, created once a session
// exists and torn down on logout. Authenticates with a short-lived ticket
// fetched over the (same-origin, proxied) REST API rather than the session
// cookie -- the socket connects directly to the backend's own origin,
// which is cross-site once frontend and backend are on different domains,
// and the cookie gets blocked there as third-party by modern browsers
// regardless of SameSite=None. See backend/src/lib/socketTickets.js.
export function SocketProvider({ children }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [onlineUserIds, setOnlineUserIds] = useState(() => new Set());
  const socketRef = useRef(null);

  useEffect(() => {
    if (!user) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocket(null);
      setOnlineUserIds(new Set());
      return;
    }

    let cancelled = false;

    api.auth
      .socketTicket()
      .then(({ ticket }) => {
        if (cancelled) return;

        const s = io(SOCKET_URL, { withCredentials: true, auth: { ticket } });
        socketRef.current = s;
        setSocket(s);

        s.on('presence:online', ({ userId }) => {
          setOnlineUserIds((prev) => new Set(prev).add(userId));
        });
        s.on('presence:offline', ({ userId }) => {
          setOnlineUserIds((prev) => {
            const next = new Set(prev);
            next.delete(userId);
            return next;
          });
        });
      })
      .catch(() => {
        // no working session to fetch a ticket with (e.g. logged out
        // right as this fired) -- just stay disconnected, nothing else
        // in the app depends on the socket existing
      });

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <SocketContext.Provider value={{ socket, onlineUserIds, isOnline: (id) => onlineUserIds.has(id) }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used inside a SocketProvider');
  return ctx;
}
