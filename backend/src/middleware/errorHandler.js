import multer from 'multer';

// one place to catch errors so the route files don't need try/catch everywhere
export function errorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `upload error: ${err.message}` });
  }

  if (err) {
    console.error(err);
    // err.status is only ever set deliberately for a message that's meant
    // to be shown to whoever made the request. anything without one is a
    // genuine unexpected failure (db error, bug) whose .message can contain
    // real internals -- logged above, replaced with a generic message here.
    const status = err.status || 500;
    const message = err.status ? err.message : 'internal server error';
    return res.status(status).json({ error: message });
  }

  next();
}

export function notFound(req, res) {
  res.status(404).json({ error: `route not found: ${req.method} ${req.originalUrl}` });
}
