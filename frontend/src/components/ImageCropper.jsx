import { useEffect, useRef, useState } from 'react';

// kept small enough that frame + modal/backdrop padding never overflows a
// 320px-wide phone viewport (the smallest realistic target here)
const FRAME_WIDTH = 260;
const OUTPUT_WIDTH = 640;
const MAX_ZOOM_MULTIPLIER = 3;

// A from-scratch pan/zoom cropper -- no dependency. Loads the picked file
// into an off-DOM Image, lets the user drag to reposition and use a slider
// to zoom (never below "fully covers the frame", same floor as CSS
// object-fit: cover), then renders exactly what's visible in the frame to
// an output canvas on confirm. shape="circle" masks the frame for avatars;
// aspect controls frame width/height ratio (1 for a square avatar, wider
// for a cover photo banner).
export default function ImageCropper({ file, aspect = 1, shape = 'circle', onCancel, onCropped }) {
  const frameHeight = Math.round(FRAME_WIDTH / aspect);
  const [imgEl, setImgEl] = useState(null);
  const [minScale, setMinScale] = useState(1);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const coverScale = Math.max(FRAME_WIDTH / img.naturalWidth, frameHeight / img.naturalHeight);
      setImgEl(img);
      setMinScale(coverScale);
      setScale(coverScale);
      setPos({ x: 0, y: 0 });
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  function clamp(nextPos, s, img) {
    const w = img.naturalWidth * s;
    const h = img.naturalHeight * s;
    const maxX = Math.max(0, (w - FRAME_WIDTH) / 2);
    const maxY = Math.max(0, (h - frameHeight) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, nextPos.x)),
      y: Math.min(maxY, Math.max(-maxY, nextPos.y)),
    };
  }

  function handlePointerDown(e) {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origin: pos };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function handlePointerMove(e) {
    if (!dragRef.current || !imgEl) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos(clamp({ x: dragRef.current.origin.x + dx, y: dragRef.current.origin.y + dy }, scale, imgEl));
  }
  function handlePointerUp() {
    dragRef.current = null;
  }

  function handleZoom(e) {
    const s = Number(e.target.value);
    setScale(s);
    if (imgEl) setPos((p) => clamp(p, s, imgEl));
  }

  function handleConfirm() {
    if (!imgEl) return;
    const outputScale = OUTPUT_WIDTH / FRAME_WIDTH;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_WIDTH;
    canvas.height = Math.round(frameHeight * outputScale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const drawW = imgEl.naturalWidth * scale * outputScale;
    const drawH = imgEl.naturalHeight * scale * outputScale;
    const drawX = canvas.width / 2 + pos.x * outputScale - drawW / 2;
    const drawY = canvas.height / 2 + pos.y * outputScale - drawH / 2;
    ctx.drawImage(imgEl, drawX, drawY, drawW, drawH);

    canvas.toBlob(
      (blob) => {
        const newName = file.name.replace(/\.\w+$/, '') + '.jpg';
        onCropped(new File([blob], newName, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92,
    );
  }

  return (
    <div className="cropper-backdrop">
      <div className="cropper-modal">
        <p className="cropper-hint">Drag to reposition, use the slider to zoom</p>
        <div
          className={`cropper-frame ${shape === 'circle' ? 'circle' : ''}`}
          style={{ width: FRAME_WIDTH, height: frameHeight }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {imgEl && (
            <img
              src={imgEl.src}
              alt=""
              className="cropper-image"
              draggable={false}
              style={{
                width: imgEl.naturalWidth * scale,
                height: imgEl.naturalHeight * scale,
                transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
              }}
            />
          )}
        </div>
        <input
          type="range"
          className="cropper-zoom"
          min={minScale}
          max={minScale * MAX_ZOOM_MULTIPLIER}
          step={(minScale * (MAX_ZOOM_MULTIPLIER - 1)) / 100}
          value={scale}
          onChange={handleZoom}
          disabled={!imgEl}
        />
        <div className="cropper-actions">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleConfirm} disabled={!imgEl}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
