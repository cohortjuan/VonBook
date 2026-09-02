import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { friendsRouter } from './routes/friends.js';
import { contactsRouter } from './routes/contacts.js';
import { postsRouter } from './routes/posts.js';
import { messagesRouter } from './routes/messages.js';
import { linkedAccountsRouter } from './routes/linked-accounts.js';
import { notificationsRouter } from './routes/notifications.js';
import { callsRouter } from './routes/calls.js';
import { adminRouter } from './routes/admin.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { requireAuth } from './middleware/requireAuth.js';
import { csrfProtection } from './middleware/csrf.js';
import { UPLOAD_DIR } from './middleware/upload.js';

dotenv.config();

export const app = express();

const configuredOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

app.use(
  cors({
    // exact allowlist only, same reasoning as Whispers App: this api sends
    // credentialed responses, so anything looser would let an arbitrary
    // origin ride a logged-in visitor's cookie.
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      return callback(null, configuredOrigins.includes(origin));
    },
    credentials: true,
  }),
);

app.use(express.json());
app.use(cookieParser());

// a generous global cap, mainly to blunt a runaway script rather than a
// real rate-limiting strategy -- individual routes (login attempts) have
// their own tighter limits below.
app.use(rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

// requireAuth only, not requireFileAccess: unlike Whispers App's family
// data, VonBook media urls are already random+unguessable and the feed
// itself is scoped to friends at the API layer (see routes/posts.js) --
// this just stops a fully anonymous, logged-out scrape of the uploads
// folder. express.static handles range requests on its own, so scrubbing
// through a video works.
app.use('/uploads', requireAuth, express.static(UPLOAD_DIR));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// signup/login can't require being logged in first -- auth.js applies
// requireAuth itself, per-route, to /logout and /me only
app.use('/api/auth', authRouter);

// every other route requires a logged-in session; csrfProtection covers
// every state-changing request on top of that
app.use('/api/users', requireAuth, csrfProtection, usersRouter);
app.use('/api/friends', requireAuth, csrfProtection, friendsRouter);
app.use('/api/contacts', requireAuth, csrfProtection, contactsRouter);
app.use('/api/posts', requireAuth, csrfProtection, postsRouter);
app.use('/api/messages', requireAuth, csrfProtection, messagesRouter);
app.use('/api/linked-accounts', requireAuth, csrfProtection, linkedAccountsRouter);
app.use('/api/notifications', requireAuth, csrfProtection, notificationsRouter);
app.use('/api/calls', requireAuth, csrfProtection, callsRouter);
app.use('/api/admin', requireAuth, csrfProtection, adminRouter);

app.use(notFound);
app.use(errorHandler);
