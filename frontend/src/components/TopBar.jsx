import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AlienLogo from './AlienLogo.jsx';

// easter eggs on the logo: 3 taps beams you into the hidden space invaders
// game (also reachable by just hitting any bad url, see SpaceInvaders.jsx
// wired as the app's 404 page); keep tapping to 5 and it also kicks off a
// few seconds of rainbow "party mode" on the header, layered on top.
export default function TopBar({ unreadNotifications = 0 }) {
  const navigate = useNavigate();
  const [partyMode, setPartyMode] = useState(false);
  const tapCount = useRef(0);
  const tapTimer = useRef(null);

  function handleLogoTap() {
    tapCount.current += 1;
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      tapCount.current = 0;
    }, 1200);

    if (tapCount.current === 3) {
      navigate('/invaders');
    }

    if (tapCount.current >= 5) {
      tapCount.current = 0;
      setPartyMode(true);
      setTimeout(() => setPartyMode(false), 4000);
    }
  }

  return (
    <header className={`topbar ${partyMode ? 'party-mode' : ''}`}>
      <button className="topbar-logo" onClick={handleLogoTap}>
        <AlienLogo size={24} />
        <span>VonBook</span>
      </button>
      <Link to="/notifications" className="topbar-bell" aria-label="Notifications">
        🔔
        {unreadNotifications > 0 && <span className="badge">{unreadNotifications > 9 ? '9+' : unreadNotifications}</span>}
      </Link>
    </header>
  );
}
