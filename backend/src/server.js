import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';

import { app } from './app.js';
import { testConnection, ensureSchema, cleanupExpiredSessions } from './db/pool.js';
import { attachSockets } from './sockets/index.js';

dotenv.config();

const PORT = process.env.PORT || 4000;
const SESSION_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

const configuredOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// check we can actually reach postgres, then make sure it has every table
// schema.sql expects, before starting the server -- way easier to debug
// than random "relation does not exist" errors on the first request
testConnection()
  .then(() => ensureSchema())
  .then(() => {
    const httpServer = createServer(app);

    // one http server, two protocols riding on it: express handles plain
    // /api requests, socket.io upgrades its own /socket.io path to a
    // websocket. same cookie-based session, checked at handshake time (see
    // sockets/index.js) instead of per express route.
    const io = new Server(httpServer, {
      cors: { origin: configuredOrigins, credentials: true },
    });
    attachSockets(io);
    app.set('io', io);

    httpServer.listen(PORT, () => {
      console.log(`VonBook api + realtime server running on http://localhost:${PORT}`);
    });

    // sweeps out expired sessions instead of letting them pile up forever
    setInterval(() => {
      cleanupExpiredSessions().catch((err) => console.error('session cleanup failed:', err.message));
    }, SESSION_CLEANUP_INTERVAL_MS);
  })
  .catch((err) => {
    console.error('could not connect to postgres, is it running? check your DATABASE_URL in .env');
    console.error(err.message);
    process.exit(1);
  });
