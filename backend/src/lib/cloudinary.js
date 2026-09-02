import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';

// optional: only touches remote storage when CLOUDINARY_URL is set (same
// fail-open shape as lib/mailer.js) -- lets local dev keep using the plain
// disk storage in middleware/upload.js without needing a cloudinary
// account, while production uploads survive a Render redeploy instead of
// living on the backend's ephemeral disk (see render.yaml's comment on why
// there's no persistent disk there). the sdk reads CLOUDINARY_URL from the
// environment on its own, nothing to configure here.
export const CLOUDINARY_ENABLED = Boolean(process.env.CLOUDINARY_URL);

// uploads a file multer already wrote to local disk, then deletes the local
// copy -- returns the new remote url, or the original local /uploads/...
// url unchanged if cloudinary isn't configured.
export async function finalizeUpload(localPath, localUrl) {
  if (!CLOUDINARY_ENABLED) return localUrl;

  const result = await cloudinary.uploader.upload(localPath, {
    resource_type: 'auto',
    folder: 'vonbook',
  });
  fs.unlink(localPath, () => {});
  return result.secure_url;
}
