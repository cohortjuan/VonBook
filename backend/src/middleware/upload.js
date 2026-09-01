import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = process.env.UPLOAD_DIR_PATH || path.join(__dirname, '..', '..', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function randomFilename(prefix, originalname) {
  const uniqueSuffix = crypto.randomBytes(16).toString('hex');
  const ext = path.extname(originalname) || '';
  return `${prefix}-${Date.now()}-${uniqueSuffix}${ext}`;
}

// ---------------------------------------------------------------------
// image "magic number" check -- the actual bytes on disk, not just the
// client-reported mimetype, so a renamed script with a faked Content-Type
// doesn't pass. Same approach as Whispers App's upload.js.
// ---------------------------------------------------------------------
const IMAGE_MAGIC_BYTES = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], skip: 4, then: [0x57, 0x45, 0x42, 0x50] },
];

function matchesSignature(buffer, sig) {
  for (let i = 0; i < sig.bytes.length; i++) {
    if (buffer[i] !== sig.bytes[i]) return false;
  }
  if (sig.then) {
    const offset = sig.bytes.length + sig.skip;
    for (let i = 0; i < sig.then.length; i++) {
      if (buffer[offset + i] !== sig.then[i]) return false;
    }
  }
  return true;
}

export function isRealImage(buffer) {
  return IMAGE_MAGIC_BYTES.some((sig) => matchesSignature(buffer, sig));
}

// ---------------------------------------------------------------------
// avatar / cover photo upload: image only, small cap, magic-byte checked
// in the route handler after multer writes the file (see routes/users.js).
// ---------------------------------------------------------------------
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, randomFilename('photo', file.originalname)),
});

// the frontend already converts HEIC (the default format for iPhone
// photos) to JPEG client-side before this ever gets hit -- see
// frontend/src/lib/imageProcessing.js -- but that conversion itself needs
// the browser to be able to decode HEIC, which only Safari can do. This
// catches the fallback case (any other browser) with a message that
// actually explains what happened, instead of the generic "unsupported
// type" list below leaving someone guessing why their phone photo failed.
function isHeic(mimetype, originalname) {
  const baseType = mimetype.split(';')[0].trim().toLowerCase();
  return baseType === 'image/heic' || baseType === 'image/heif' || /\.hei[cf]$/i.test(originalname || '');
}

function photoFileFilter(req, file, cb) {
  const baseType = file.mimetype.split(';')[0].trim().toLowerCase();
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(baseType)) {
    cb(null, true);
  } else if (isHeic(file.mimetype, file.originalname)) {
    const err = new Error(
      'that iPhone photo is in HEIC format, which this browser can\'t open. On the phone: Settings > Camera > Formats > "Most Compatible", or share the photo through Messages/Airdrop first to convert it, then try again.',
    );
    err.status = 400;
    cb(err);
  } else {
    const err = new Error(`unsupported photo type: ${file.mimetype}. please upload a JPEG, PNG, GIF, or WebP image`);
    err.status = 400;
    cb(err);
  }
}

const MAX_PHOTO_MB = 8;

export const photoUpload = multer({
  storage: photoStorage,
  fileFilter: photoFileFilter,
  limits: { fileSize: MAX_PHOTO_MB * 1024 * 1024 },
});

// ---------------------------------------------------------------------
// post media upload: images or short video clips, up to MAX_UPLOAD_MB.
// video isn't magic-byte checked (container formats vary too much to
// pin down a short signature list the way still images allow) -- same
// trust-the-mimetype tradeoff Whispers App makes for its audio/video
// clips, which is fine here since these are served back inline, never
// executed.
// ---------------------------------------------------------------------
const mediaStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, randomFilename('post', file.originalname)),
});

function mediaFileFilter(req, file, cb) {
  const baseType = file.mimetype.split(';')[0].trim().toLowerCase();
  if (isHeic(file.mimetype, file.originalname)) {
    // accepting this would "succeed" and then silently show as a broken
    // image to almost everyone -- see the comment on photoFileFilter above,
    // same story here, just for post photos instead of avatars
    const err = new Error(
      'that iPhone photo is in HEIC format, which this browser can\'t open. On the phone: Settings > Camera > Formats > "Most Compatible", or share the photo through Messages/Airdrop first to convert it, then try again.',
    );
    err.status = 400;
    cb(err);
  } else if (baseType.startsWith('image/') || baseType.startsWith('video/')) {
    cb(null, true);
  } else {
    const err = new Error(`unsupported file type: ${file.mimetype}. please upload an image or video`);
    err.status = 400;
    cb(err);
  }
}

const maxUploadMb = Number(process.env.MAX_UPLOAD_MB) || 50;

export const mediaUpload = multer({
  storage: mediaStorage,
  fileFilter: mediaFileFilter,
  limits: { fileSize: maxUploadMb * 1024 * 1024, files: 10 },
});
