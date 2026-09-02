import { useEffect, useRef } from 'react';

const KEY_SEQUENCE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

// mobile has no arrow keys to press, so the same 10-step code is replayed as
// touch gestures instead: swipe up/down/left/right stand in for the arrow
// keys, two quick taps stand in for b/a.
const SWIPE_SEQUENCE = ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'tap', 'tap'];

const SWIPE_MIN_DISTANCE = 30; // px -- below this a touch reads as a tap, not a swipe
const TAP_MAX_DURATION = 300; // ms -- longer than this is a hold, not a tap (ignored, doesn't reset progress)

// easter egg #1: the classic konami code, anywhere in the app -- keyboard on
// desktop, touch gestures on mobile (see SWIPE_SEQUENCE above)
export function useKonamiCode(onUnlock) {
  const keyProgress = useRef(0);
  const swipeProgress = useRef(0);
  const touchStart = useRef(null);

  useEffect(() => {
    function handleKeyDown(e) {
      const expected = KEY_SEQUENCE[keyProgress.current];
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === expected) {
        keyProgress.current += 1;
        if (keyProgress.current === KEY_SEQUENCE.length) {
          keyProgress.current = 0;
          onUnlock();
        }
      } else {
        keyProgress.current = key === KEY_SEQUENCE[0] ? 1 : 0;
      }
    }

    function handleTouchStart(e) {
      const t = e.touches[0];
      touchStart.current = { x: t.clientX, y: t.clientY, time: Date.now() };
    }

    function handleTouchEnd(e) {
      const start = touchStart.current;
      touchStart.current = null;
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const distance = Math.hypot(dx, dy);

      let gesture;
      if (distance < SWIPE_MIN_DISTANCE) {
        if (Date.now() - start.time > TAP_MAX_DURATION) return;
        gesture = 'tap';
      } else if (Math.abs(dx) > Math.abs(dy)) {
        gesture = dx > 0 ? 'right' : 'left';
      } else {
        gesture = dy > 0 ? 'down' : 'up';
      }

      const expected = SWIPE_SEQUENCE[swipeProgress.current];
      if (gesture === expected) {
        swipeProgress.current += 1;
        if (swipeProgress.current === SWIPE_SEQUENCE.length) {
          swipeProgress.current = 0;
          onUnlock();
        }
      } else {
        swipeProgress.current = gesture === SWIPE_SEQUENCE[0] ? 1 : 0;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onUnlock]);
}
