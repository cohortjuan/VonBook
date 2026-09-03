import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { hashPassword } from './password.js';
import { FEEDS, fetchFeedItems } from './rssFeeds.js';

const VONBOT_USERNAME = 'vonbot';
const VONBOT_EMAIL = 'vonbot@vonbook.local';

// get-or-create so this is safe to call on every tick -- VonBot is a real
// row in `users` (not a special-cased author id) specifically so its posts
// flow through the exact same feed/like/comment code every other post
// does. its password is a real bcrypt hash of a random string nobody
// knows, same idea as auth.js's DUMMY_HASH -- nothing ever logs in as it.
async function getOrCreateVonBot() {
  const existing = await pool.query('SELECT id FROM users WHERE username = $1', [VONBOT_USERNAME]);
  if (existing.rows[0]) return existing.rows[0].id;

  const passwordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
  const result = await pool.query(
    `INSERT INTO users (email, username, password_hash, display_name, bio)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      VONBOT_EMAIL,
      VONBOT_USERNAME,
      passwordHash,
      'VonBot',
      "🤖 keeping the feed juiced with gaming, anime, and movie news. I'm a bot, not Von!",
    ],
  );
  return result.rows[0].id;
}

// picks one feed at random (so no single topic dominates over many ticks)
// and posts the first item VonBot hasn't already reposted, always marked
// public (see is_public on posts) so it lands in everyone's feed without
// VonBot needing to friend anyone. returns null, not an error, when every
// current item has already been seen -- that's an expected outcome on a
// quiet news day, not a failure.
export async function runVonBotTick() {
  const vonbotId = await getOrCreateVonBot();
  const source = FEEDS[Math.floor(Math.random() * FEEDS.length)];

  const candidates = await fetchFeedItems(source, 10);
  for (const item of candidates) {
    const seen = await pool.query('SELECT 1 FROM vonbot_seen WHERE source_id = $1', [item.id]);
    if (seen.rows.length > 0) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const postResult = await client.query(
        `INSERT INTO posts (author_id, caption, is_public) VALUES ($1, $2, true) RETURNING id`,
        [vonbotId, `${item.title}\n\n🤖 ${item.label} -- ${item.link}`],
      );
      await client.query(
        `INSERT INTO post_media (post_id, media_url, media_type, position) VALUES ($1, $2, 'image', 0)`,
        [postResult.rows[0].id, item.imageUrl],
      );
      await client.query('INSERT INTO vonbot_seen (source_id) VALUES ($1)', [item.id]);
      await client.query('COMMIT');
      return { postId: postResult.rows[0].id, title: item.title, label: item.label };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return null;
}
