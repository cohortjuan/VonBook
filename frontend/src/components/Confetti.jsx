import { useEffect, useRef } from 'react';

const COLORS = ['#f59e0b', '#2563eb', '#0ea5e9', '#06b6d4', '#4ade80'];

// lightweight canvas confetti burst, no dependency. renders full-screen,
// fixed, pointer-events none, and calls onDone when the burst has settled.
export default function Confetti({ onDone }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const pieces = Array.from({ length: 140 }, () => ({
      x: Math.random() * width,
      y: -20 - Math.random() * height * 0.3,
      size: 6 + Math.random() * 6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      speedY: 3 + Math.random() * 3,
      speedX: -1.5 + Math.random() * 3,
      rotation: Math.random() * 360,
      spin: -6 + Math.random() * 12,
    }));

    let frame;
    let elapsed = 0;
    const MAX_DURATION_MS = 8000; // safety cap in case a piece never clears (shouldn't happen, but never hang forever)
    const GRAVITY = 0.08; // pieces accelerate as they fall, like real confetti settling

    function tick() {
      elapsed += 16;
      ctx.clearRect(0, 0, width, height);
      let allOffscreen = true;
      pieces.forEach((p) => {
        p.speedY += GRAVITY;
        p.x += p.speedX;
        p.y += p.speedY;
        p.rotation += p.spin;
        if (p.y < height + 30) allOffscreen = false;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      });

      if (!allOffscreen && elapsed < MAX_DURATION_MS) {
        frame = requestAnimationFrame(tick);
      } else {
        onDone?.();
      }
    }
    frame = requestAnimationFrame(tick);

    function handleResize() {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />;
}
