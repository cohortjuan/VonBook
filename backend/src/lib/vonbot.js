import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { hashPassword } from './password.js';
import { FEEDS, fetchFeedItems } from './rssFeeds.js';

const VONBOT_USERNAME = 'vonbot';
const VONBOT_EMAIL = 'vonbot@vonbook.local';

const INTRO_CAPTION = `👋 Hey, I'm VonBot!

I'm not a real person -- I'm a bot that keeps this feed a little more alive between real posts. A few times a day I'll post one trending pic from gaming, anime, movies, or superhero news, pulled from real outlets (IGN, MyAnimeList, SlashFilm, ScreenRant).

I'm always public, so you'll see my posts even if we're not friends. If I ever post something that shouldn't be here, hit 🚩 on it and it gets pulled for review right away.

That's it -- back to the regular feed. 🎮`;

// get-or-create so this is safe to call on every tick -- VonBot is a real
// row in `users` (not a special-cased author id) specifically so its posts
// flow through the exact same feed/like/comment code every other post
// does. its password is a real bcrypt hash of a random string nobody
// knows, same idea as auth.js's DUMMY_HASH -- nothing ever logs in as it.
// returns whether the account was just created this call, so
// runVonBotTick can post the intro instead of a random repost the very
// first time this ever runs.
async function getOrCreateVonBot() {
  const existing = await pool.query('SELECT id FROM users WHERE username = $1', [VONBOT_USERNAME]);
  if (existing.rows[0]) return { id: existing.rows[0].id, justCreated: false };

  const passwordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
  const result = await pool.query(
    `INSERT INTO users (email, username, password_hash, display_name, bio)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      VONBOT_EMAIL,
      VONBOT_USERNAME,
      passwordHash,
      'VonBot',
      "🤖 I'm a bot, not Von! A few times a day I repost one trending pic from gaming, anime, movie, or superhero news to keep this feed a little more alive. See something that shouldn't be here? Hit 🚩 report on it.",
    ],
  );
  return { id: result.rows[0].id, justCreated: true };
}

// picks one feed at random (so no single topic dominates over many ticks)
// and posts the first item VonBot hasn't already reposted, always marked
// public (see is_public on posts) so it lands in everyone's feed without
// VonBot needing to friend anyone. returns null, not an error, when every
// current item has already been seen -- that's an expected outcome on a
// quiet news day, not a failure.
export async function runVonBotTick() {
  const { id: vonbotId, justCreated } = await getOrCreateVonBot();

  if (justCreated) {
    const introResult = await pool.query(
      `INSERT INTO posts (author_id, caption, is_public) VALUES ($1, $2, true) RETURNING id`,
      [vonbotId, INTRO_CAPTION],
    );
    // first real repost happens next tick, not stacked onto the intro --
    // keeps the intro as the one clear first thing anyone sees from VonBot
    return { postId: introResult.rows[0].id, title: 'intro post', label: 'intro' };
  }

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

// posts a one-off, human-written caption as VonBot -- see routes/vonbot.js's
// /announce. Separate from runVonBotTick's automatic RSS reposts since this
// is for things that need real copy (a feature announcement, etc.), not a
// feed item pulled from a source. Reuses VonBot's current avatar as the
// post's photo when he has one, so an occasional announcement like this
// doesn't need a separate image upload step.
export async function postVonBotAnnouncement(caption) {
  const vonbotResult = await pool.query("SELECT id, avatar_url FROM users WHERE username = $1 AND deleted_at IS NULL", [
    VONBOT_USERNAME,
  ]);
  const vonbot = vonbotResult.rows[0];
  if (!vonbot) throw new Error("vonbot doesn't have an account yet -- it's created automatically on its first successful posting tick");

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const postResult = await client.query(`INSERT INTO posts (author_id, caption, is_public) VALUES ($1, $2, true) RETURNING id`, [
      vonbot.id,
      caption,
    ]);
    if (vonbot.avatar_url) {
      await client.query(`INSERT INTO post_media (post_id, media_url, media_type, position) VALUES ($1, $2, 'image', 0)`, [
        postResult.rows[0].id,
        vonbot.avatar_url,
      ]);
    }
    await client.query('COMMIT');
    return postResult.rows[0].id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
