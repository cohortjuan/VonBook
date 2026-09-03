import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AlienLogo from './AlienLogo.jsx';

// easter eggs on the logo: 3 taps beams you into the hidden space invaders
// game (also reachable by just hitting any bad url, see SpaceInvaders.jsx
// wired as the app's 404 page); keep tapping to 5 and it does rainbow
// "party mode" on the header instead. the decision waits until taps
// actually stop coming in (same short window that resets the counter)
// rather than firing the moment the count hits 3 -- navigating away at
// tap 3 used to unmount this component (the invaders route lives outside
// the layout that renders TopBar at all), which wiped tapCount and made
// 5 taps physically unreachable.
export default function TopBar({ unreadNotifications = 0 }) {
  const navigate = useNavigate();
  const [partyMode, setPartyMode] = useState(false);
  const tapCount = useRef(0);
  const tapTimer = useRef(null);

  function handleLogoTap() {
    tapCount.current += 1;
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      const taps = tapCount.current;
      tapCount.current = 0;
      if (taps >= 5) {
        setPartyMode(true);
        setTimeout(() => setPartyMode(false), 4000);
      } else if (taps >= 3) {
        navigate('/invaders');
      }
    }, 400);
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
