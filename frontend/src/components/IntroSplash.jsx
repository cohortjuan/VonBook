import { useEffect, useRef, useState } from 'react';
import AlienLogo from './AlienLogo.jsx';

// starts fading the logo/wordmark/tagline in once this many seconds of the
// video remain -- each child then staggers in on its own via css
// transition-delay (see .intro-splash-overlay in index.css)
const OVERLAY_LEAD_SECONDS = 5;
// must match the .intro-splash-frame.power-off animation duration in css
const POWER_OFF_MS = 650;
// duration/currentTime (and so the OVERLAY_LEAD_SECONDS check above) are
// unaffected by this -- playbackRate only changes how fast real time maps
// to media time, not the media's own reported position
const PLAYBACK_RATE = 1.1;

// plays once, in front of the real Landing page underneath (still mounted
// the whole time -- this is purely an overlay). in the last few seconds of
// the video the logo/wordmark/tagline fade in over it; when the video ends,
// a quick "old tv turning off" collapse plays, then this unmounts itself
// via onFinished, revealing Landing.
export default function IntroSplash({ onFinished }) {
  const videoRef = useRef(null);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [poweringOff, setPoweringOff] = useState(false);
  const [muted, setMuted] = useState(true);

  function finish() {
    setPoweringOff(true);
    setTimeout(onFinished, POWER_OFF_MS);
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = PLAYBACK_RATE;

    function handleTimeUpdate() {
      if (video.duration && video.duration - video.currentTime <= OVERLAY_LEAD_SECONDS) {
        setOverlayVisible(true);
      }
    }
    function handleEnded() {
      finish();
    }

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`intro-splash-frame ${poweringOff ? 'power-off' : ''}`}>
      <video
        ref={videoRef}
        className="intro-splash-video"
        src="/intro-video.mp4"
        autoPlay
        muted={muted}
        playsInline
        // if the file's missing or fails to decode, don't strand a visitor
        // staring at a black screen forever -- just skip straight through
        onError={finish}
      />

      <div className={`intro-splash-overlay ${overlayVisible ? 'visible' : ''}`}>
        <AlienLogo size={64} color="#ffffff" />
        <h1 className="intro-splash-title">VonBook</h1>
        <p className="intro-splash-tagline">the gamers lounge</p>
      </div>

      <button className="intro-splash-mute" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute' : 'Mute'}>
        {muted ? '🔇' : '🔊'}
      </button>
      <button className="intro-splash-skip" onClick={finish}>
        Skip →
      </button>
    </div>
  );
}
