import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext.jsx';

const SocketContext = createContext(null);

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

// one socket.io connection for the whole app, created once a session
// exists and torn down on logout. the connection itself carries the same
// session cookie the rest of the api uses (see backend/src/sockets/
// index.js's handshake auth) -- no separate token to manage here.
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

    const s = io(SOCKET_URL, { withCredentials: true });
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

    return () => {
      s.disconnect();
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
