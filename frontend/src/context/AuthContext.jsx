import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

// the session lives in an httpOnly cookie the backend manages entirely --
// this context never sees or stores a token, it just asks "who am I" on
// load and after each auth action.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.auth
      .me()
      .then((u) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(credentials) {
    const loggedInUser = await api.auth.login(credentials);
    setUser(loggedInUser);
    return loggedInUser;
  }

  // /auth/signup doesn't itself establish a session (matches the backend's
  // auth.js) -- chaining straight into login makes it feel like one flow
  async function signup(payload) {
    await api.auth.signup(payload);
    return login({ identifier: payload.email, password: payload.password });
  }

  async function logout() {
    try {
      await api.auth.logout();
    } finally {
      setUser(null);
    }
  }

  async function refreshUser() {
    const freshUser = await api.auth.me();
    setUser(freshUser);
    return freshUser;
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider');
  return ctx;
}
