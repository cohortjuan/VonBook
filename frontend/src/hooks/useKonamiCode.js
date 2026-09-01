import { useEffect, useRef } from 'react';

const SEQUENCE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

// easter egg #1: the classic konami code, anywhere in the app
export function useKonamiCode(onUnlock) {
  const progress = useRef(0);

  useEffect(() => {
    function handleKeyDown(e) {
      const expected = SEQUENCE[progress.current];
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === expected) {
        progress.current += 1;
        if (progress.current === SEQUENCE.length) {
          progress.current = 0;
          onUnlock();
        }
      } else {
        progress.current = key === SEQUENCE[0] ? 1 : 0;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onUnlock]);
}
