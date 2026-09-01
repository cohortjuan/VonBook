import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';

const ALIEN_PATTERN = [
  '..X.....X..',
  '...X...X...',
  '..XXXXXXX..',
  '.XX.XXX.XX.',
  'XXXXXXXXXXX',
  'X.XXXXXXX.X',
  'X.X.....X.X',
  '...XX.XX...',
];

const CANVAS_W = 320;
const CANVAS_H = 420;
const ALIEN_ROWS = 4;
const ALIEN_COLS = 7;
const ALIEN_SIZE = 22;
const ALIEN_GAP = 10;
const PLAYER_W = 30;
const PLAYER_H = 14;
const BULLET_SPEED = 6;
const PLAYER_SPEED = 4;

function buildAliens() {
  const grid = [];
  const startX = (CANVAS_W - (ALIEN_COLS * (ALIEN_SIZE + ALIEN_GAP) - ALIEN_GAP)) / 2;
  for (let row = 0; row < ALIEN_ROWS; row++) {
    for (let col = 0; col < ALIEN_COLS; col++) {
      grid.push({
        x: startX + col * (ALIEN_SIZE + ALIEN_GAP),
        y: 40 + row * (ALIEN_SIZE + ALIEN_GAP),
        alive: true,
      });
    }
  }
  return grid;
}

function drawAlienSprite(ctx, x, y, size, color) {
  const cell = size / ALIEN_PATTERN[0].length;
  ctx.fillStyle = color;
  ALIEN_PATTERN.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === 'X') ctx.fillRect(x + c * cell, y + r * cell, cell, cell);
    });
  });
}

// This app's honest 404 page: hitting a url that doesn't exist (or tapping
// the alien logo three times, see TopBar.jsx) lands here instead of a bare
// "not found" message. Runs entirely on a canvas + requestAnimationFrame,
// game state lives in refs (not React state) so the ~60fps loop never
// fights react's render cycle -- score/status are the only things that
// actually need to trigger a re-render.
export default function SpaceInvaders() {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const keysRef = useRef(new Set());
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState('playing'); // playing | won | lost
  const [runId, setRunId] = useState(0);

  const restart = useCallback(() => {
    setScore(0);
    setStatus('playing');
    setRunId((n) => n + 1);
  }, []);

  useEffect(() => {
    stateRef.current = {
      player: { x: CANVAS_W / 2 - PLAYER_W / 2 },
      bullets: [],
      aliens: buildAliens(),
      direction: 1,
      alienSpeed: 0.6,
      lastShot: 0,
    };

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let frame;
    let running = true;

    function shoot() {
      const s = stateRef.current;
      const now = performance.now();
      if (now - s.lastShot < 350) return;
      s.lastShot = now;
      s.bullets.push({ x: s.player.x + PLAYER_W / 2 - 2, y: CANVAS_H - PLAYER_H - 20 });
    }

    function handleKeyDown(e) {
      keysRef.current.add(e.key);
      if (e.key === ' ' || e.key === 'ArrowUp') {
        e.preventDefault();
        shoot();
      }
    }
    function handleKeyUp(e) {
      keysRef.current.delete(e.key);
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    canvasRef.current.shootNow = shoot;

    function tick() {
      if (!running) return;
      const s = stateRef.current;

      if (keysRef.current.has('ArrowLeft')) s.player.x -= PLAYER_SPEED;
      if (keysRef.current.has('ArrowRight')) s.player.x += PLAYER_SPEED;
      s.player.x = Math.max(0, Math.min(CANVAS_W - PLAYER_W, s.player.x));

      s.bullets = s.bullets.filter((b) => b.y > 0);
      s.bullets.forEach((b) => (b.y -= BULLET_SPEED));

      const aliveAliens = s.aliens.filter((a) => a.alive);
      let hitEdge = false;
      aliveAliens.forEach((a) => {
        a.x += s.direction * s.alienSpeed;
        if (a.x <= 0 || a.x + ALIEN_SIZE >= CANVAS_W) hitEdge = true;
      });
      if (hitEdge) {
        s.direction *= -1;
        aliveAliens.forEach((a) => (a.y += 12));
      }

      // bullet/alien collision
      s.bullets.forEach((b) => {
        aliveAliens.forEach((a) => {
          if (a.alive && b.x > a.x && b.x < a.x + ALIEN_SIZE && b.y > a.y && b.y < a.y + ALIEN_SIZE) {
            a.alive = false;
            b.y = -100;
            setScore((sc) => sc + 10);
          }
        });
      });

      const stillAlive = s.aliens.some((a) => a.alive);
      const reachedBottom = s.aliens.some((a) => a.alive && a.y + ALIEN_SIZE >= CANVAS_H - PLAYER_H - 30);

      if (!stillAlive) {
        running = false;
        setStatus('won');
      } else if (reachedBottom) {
        running = false;
        setStatus('lost');
      }

      ctx.fillStyle = '#0a0e1a';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      s.aliens.forEach((a) => {
        if (a.alive) drawAlienSprite(ctx, a.x, a.y, ALIEN_SIZE, '#06b6d4');
      });

      ctx.fillStyle = '#f8fafc';
      s.bullets.forEach((b) => ctx.fillRect(b.x, b.y, 3, 10));

      ctx.fillStyle = '#2563eb';
      ctx.fillRect(s.player.x, CANVAS_H - PLAYER_H - 12, PLAYER_W, PLAYER_H);
      ctx.fillRect(s.player.x + PLAYER_W / 2 - 3, CANVAS_H - PLAYER_H - 20, 6, 8);

      if (running) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [runId]);

  function press(key) {
    keysRef.current.add(key);
  }
  function release(key) {
    keysRef.current.delete(key);
  }

  return (
    <div className="invaders-page">
      <h1 className="invaders-title">404: PLANET NOT FOUND</h1>
      <p className="invaders-sub">There's nothing at that address. Defend VonBook instead?</p>

      <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="invaders-canvas" />

      <div className="invaders-hud">
        <span>SCORE: {score}</span>
        {status === 'won' && <span className="invaders-result win">YOU WIN! 👾</span>}
        {status === 'lost' && <span className="invaders-result lose">GAME OVER</span>}
      </div>

      {status !== 'playing' && (
        <button className="btn-primary" onClick={restart}>
          Play again
        </button>
      )}

      <div className="invaders-controls">
        <button
          className="invaders-btn"
          onTouchStart={() => press('ArrowLeft')}
          onTouchEnd={() => release('ArrowLeft')}
          onMouseDown={() => press('ArrowLeft')}
          onMouseUp={() => release('ArrowLeft')}
          onMouseLeave={() => release('ArrowLeft')}
        >
          ⬅
        </button>
        <button className="invaders-btn invaders-btn-fire" onClick={() => canvasRef.current?.shootNow?.()}>
          🔫 FIRE
        </button>
        <button
          className="invaders-btn"
          onTouchStart={() => press('ArrowRight')}
          onTouchEnd={() => release('ArrowRight')}
          onMouseDown={() => press('ArrowRight')}
          onMouseUp={() => release('ArrowRight')}
          onMouseLeave={() => release('ArrowRight')}
        >
          ➡
        </button>
      </div>
      <p className="invaders-hint">Arrow keys to move, space to fire -- or use the buttons above</p>

      <Link to="/" className="invaders-home-link">
        ← Back to VonBook
      </Link>
    </div>
  );
}
