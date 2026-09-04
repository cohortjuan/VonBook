import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import { CallProvider } from './context/CallContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import RequireAuth from './components/RequireAuth.jsx';
import Layout from './components/Layout.jsx';
import HomeGate from './components/HomeGate.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Profile from './pages/Profile.jsx';
import PostDetail from './pages/PostDetail.jsx';
import Settings from './pages/Settings.jsx';
import Friends from './pages/Friends.jsx';
import Messages from './pages/Messages.jsx';
import Conversation from './pages/Conversation.jsx';
import Notifications from './pages/Notifications.jsx';
import SpaceInvaders from './pages/SpaceInvaders.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <SocketProvider>
            <CallProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/" element={<HomeGate />} />
                <Route
                  element={
                    <RequireAuth>
                      <Layout />
                    </RequireAuth>
                  }
                >
                  <Route path="/friends" element={<Friends />} />
                  <Route path="/messages" element={<Messages />} />
                  <Route path="/messages/:id" element={<Conversation />} />
                  <Route path="/notifications" element={<Notifications />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/u/:username" element={<Profile />} />
                  <Route path="/post/:id" element={<PostDetail />} />
                </Route>
                <Route path="*" element={<SpaceInvaders />} />
              </Routes>
            </CallProvider>
          </SocketProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
