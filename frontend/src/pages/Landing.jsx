import { useState } from 'react';
import { Link } from 'react-router-dom';
import IntroSplash from '../components/IntroSplash.jsx';

// The public front door -- what a signed-out visitor sees at "/". The
// cinematic intro (frontend/public/intro-video.mp4) plays once as an
// overlay in front of this page (see IntroSplash.jsx); this hero is
// already mounted underneath the whole time, so when the intro "powers
// off" it's revealing a page that was there all along, not navigating
// anywhere new.
export default function Landing() {
  const [showIntro, setShowIntro] = useState(true);

  return (
    <div className="landing">
      {showIntro && <IntroSplash onFinished={() => setShowIntro(false)} />}

      <nav className="landing-nav">
        <span className="landing-nav-brand">VonBook</span>
        <div className="landing-nav-actions">
          <Link to="/login" className="landing-nav-btn">
            Sign in
          </Link>
          <Link to="/signup" className="landing-nav-btn landing-nav-btn-primary">
            Create account
          </Link>
        </div>
      </nav>

      <header className="landing-hero">
        <div className="landing-hero-content">
          <h1 className="landing-wordmark">VonBook</h1>
          <p className="landing-tagline">the gamers lounge -- friends, feed, chat, calls, all in one place.</p>
          <div className="landing-hero-actions">
            <Link to="/signup" className="btn-primary landing-hero-btn">
              Create account
            </Link>
            <Link to="/login" className="landing-hero-link">
              Already have an account? Sign in
            </Link>
          </div>
        </div>
      </header>

      <footer className="landing-footer">
        &copy; {new Date().getFullYear()}{' '}
        <a href="https://github.com/cohortjuan" target="_blank" rel="noopener noreferrer">
          github.com/cohortjuan
        </a>
      </footer>
    </div>
  );
}
