// Normalizes a picked image file to a JPEG before it ever reaches the
// backend. This exists specifically for iPhone photos: they save as HEIC
// by default, which uploads and stores just fine, but most browsers
// (Chrome, Firefox, Edge -- everything except Safari) simply can't decode
// HEIC in an <img> tag, so the photo would silently fail to render for
// anyone except the photo's own owner on Safari. Drawing through a canvas
// also fixes a second, unrelated real-world bug for free: it bakes in EXIF
// orientation, so photos taken in portrait no longer show up sideways.
//
// Safari itself CAN decode HEIC (it just can't display the raw file
// directly in most *other* browsers), so this conversion works precisely
// on the devices most likely to produce a HEIC file in the first place.
// If the browser can't decode the file at all, this falls back to the
// original file untouched rather than blocking the upload -- the
// backend's own format validation is still the real safety net.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.9;

export async function normalizeImageFile(file) {
  if (!file.type.startsWith('image/')) return file;

  let bitmap;
  try {
    // createImageBitmap fully decodes the image before resolving -- unlike
    // an <img>'s load event, which can fire before the browser has
    // actually finished decoding pixel data (especially for large photos
    // or HEIC on mobile Safari). Drawing to canvas right after `load`
    // instead of after a real decode is exactly what produced solid
    // black output: the canvas was capturing a not-yet-painted frame.
    bitmap = await createImageBitmap(file);
  } catch {
    // browser genuinely can't decode this format at all (e.g. HEIC on a
    // non-Safari browser) -- hand back the original and let the backend's
    // format check give a clear error instead of losing the upload silently
    return file;
  }

  try {
    let { width, height } = bitmap;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const scale = MAX_DIMENSION / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // JPEG has no alpha channel -- fill white first so a transparent PNG
    // doesn't come out with a black background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) return file;

    const newName = file.name.replace(/\.\w+$/, '') + '.jpg';
    return new File([blob], newName, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export function normalizeImageFiles(files) {
  return Promise.all(files.map(normalizeImageFile));
}
