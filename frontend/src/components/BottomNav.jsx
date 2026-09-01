import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Avatar from './Avatar.jsx';

export default function BottomNav({ unreadMessages = 0 }) {
  const { user } = useAuth();

  return (
    <nav className="bottom-nav">
      <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <span className="nav-icon">🏠</span>
        <span>Feed</span>
      </NavLink>
      <NavLink to="/friends" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <span className="nav-icon">👥</span>
        <span>Friends</span>
      </NavLink>
      <NavLink to="/messages" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <span className="nav-icon">
          💬
          {unreadMessages > 0 && <span className="badge badge-nav">{unreadMessages > 9 ? '9+' : unreadMessages}</span>}
        </span>
        <span>Chat</span>
      </NavLink>
      <NavLink to={`/u/${user?.username}`} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <Avatar user={user} size={26} />
        <span>Me</span>
      </NavLink>
    </nav>
  );
}
