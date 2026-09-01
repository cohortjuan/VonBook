import { Router } from 'express';
import { pool } from '../db/pool.js';
import { getFriendIds, areFriends } from '../lib/friends.js';
import { isBlockedEitherWay } from '../lib/blocks.js';
import { createNotification } from '../lib/notify.js';
import { mediaUpload } from '../middleware/upload.js';
import { normalizeUsername } from '../lib/normalize.js';

export const postsRouter = Router();

const AUTHOR_COLUMNS = 'u.id AS author_id, u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar_url, u.is_founder AS author_is_founder, u.founder_title AS author_founder_title, u.is_dev AS author_is_dev';

async function attachMediaAndCounts(posts, viewerId) {
  if (posts.length === 0) return posts;
  const postIds = posts.map((p) => p.id);

  const [media, likeCounts, myLikes, commentCounts] = await Promise.all([
    pool.query('SELECT post_id, media_url, media_type, position FROM post_media WHERE post_id = ANY($1) ORDER BY position', [postIds]),
    pool.query('SELECT post_id, COUNT(*)::int AS count FROM post_likes WHERE post_id = ANY($1) GROUP BY post_id', [postIds]),
    pool.query('SELECT post_id FROM post_likes WHERE post_id = ANY($1) AND user_id = $2', [postIds, viewerId]),
    pool.query('SELECT post_id, COUNT(*)::int AS count FROM post_comments WHERE post_id = ANY($1) GROUP BY post_id', [postIds]),
  ]);

  const mediaByPost = new Map();
  for (const row of media.rows) {
    if (!mediaByPost.has(row.post_id)) mediaByPost.set(row.post_id, []);
    mediaByPost.get(row.post_id).push(row);
  }
  const likeCountByPost = new Map(likeCounts.rows.map((r) => [r.post_id, r.count]));
  const likedByMe = new Set(myLikes.rows.map((r) => r.post_id));
  const commentCountByPost = new Map(commentCounts.rows.map((r) => [r.post_id, r.count]));

  return posts.map((post) => ({
    ...post,
    media: mediaByPost.get(post.id) || [],
    like_count: likeCountByPost.get(post.id) || 0,
    liked_by_me: likedByMe.has(post.id),
    comment_count: commentCountByPost.get(post.id) || 0,
  }));
}

// GET /api/posts/feed?before=<postId> -- your own posts + friends' posts,
// newest first, cursor-paginated by post id
postsRouter.get('/feed', async (req, res, next) => {
  try {
    const friendIds = await getFriendIds(req.user.id);
    const authorIds = [req.user.id, ...friendIds];
    const before = Number(req.query.before) || null;

    const result = await pool.query(
      `SELECT p.id, p.caption, p.game_tag, p.created_at, ${AUTHOR_COLUMNS}
       FROM posts p JOIN users u ON u.id = p.author_id
       WHERE p.author_id = ANY($1) AND p.deleted_at IS NULL
         AND ($2::int IS NULL OR p.id < $2)
       ORDER BY p.id DESC
       LIMIT 20`,
      [authorIds, before],
    );

    res.json(await attachMediaAndCounts(result.rows, req.user.id));
  } catch (err) {
    next(err);
  }
});

// GET /api/posts/user/:username -- one person's posts (their own profile
// grid). requires being that person or their friend, same rule as the feed.
postsRouter.get('/user/:username', async (req, res, next) => {
  try {
    const username = normalizeUsername(req.params.username);
    const userResult = await pool.query('SELECT id FROM users WHERE username = $1 AND deleted_at IS NULL', [username]);
    const author = userResult.rows[0];
    if (!author) return res.status(404).json({ error: 'user not found' });

    if (author.id !== req.user.id) {
      if (await isBlockedEitherWay(req.user.id, author.id)) return res.status(404).json({ error: 'user not found' });
      if (!(await areFriends(req.user.id, author.id))) return res.json([]);
    }

    const result = await pool.query(
      `SELECT p.id, p.caption, p.game_tag, p.created_at, ${AUTHOR_COLUMNS}
       FROM posts p JOIN users u ON u.id = p.author_id
       WHERE p.author_id = $1 AND p.deleted_at IS NULL
       ORDER BY p.id DESC LIMIT 60`,
      [author.id],
    );
    res.json(await attachMediaAndCounts(result.rows, req.user.id));
  } catch (err) {
    next(err);
  }
});

// POST /api/posts { caption, game_tag? } + up to 10 files under field "media"
postsRouter.post('/', mediaUpload.array('media', 10), async (req, res, next) => {
  try {
    const caption = typeof req.body.caption === 'string' ? req.body.caption.trim() : '';
    const gameTag = typeof req.body.game_tag === 'string' ? req.body.game_tag.trim().slice(0, 100) : '';
    const files = req.files || [];
    if (!caption && files.length === 0) {
      return res.status(400).json({ error: 'a post needs a caption or at least one photo/video' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const postResult = await client.query(
        `INSERT INTO posts (author_id, caption, game_tag) VALUES ($1, $2, $3) RETURNING id, caption, game_tag, created_at`,
        [req.user.id, caption || null, gameTag || null],
      );
      const post = postResult.rows[0];

      for (let i = 0; i < files.length; i++) {
        const mediaType = files[i].mimetype.startsWith('video/') ? 'video' : 'image';
        await client.query(
          `INSERT INTO post_media (post_id, media_url, media_type, position) VALUES ($1, $2, $3, $4)`,
          [post.id, `/uploads/${files[i].filename}`, mediaType, i],
        );
      }

      await client.query('COMMIT');

      const [full] = await attachMediaAndCounts(
        [{ ...post, author_id: req.user.id, author_username: req.user.username, author_display_name: req.user.display_name, author_avatar_url: req.user.avatar_url, author_is_founder: req.user.is_founder, author_founder_title: req.user.founder_title, author_is_dev: req.user.is_dev }],
        req.user.id,
      );
      res.status(201).json(full);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// DELETE /api/posts/:postId -- author only, soft delete
postsRouter.delete('/:postId', async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE posts SET deleted_at = now() WHERE id = $1 AND author_id = $2 AND deleted_at IS NULL RETURNING id`,
      [req.params.postId, req.user.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'post not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

async function loadPostAuthor(postId) {
  const result = await pool.query('SELECT author_id FROM posts WHERE id = $1 AND deleted_at IS NULL', [postId]);
  return result.rows[0]?.author_id ?? null;
}

// POST /api/posts/:postId/like
postsRouter.post('/:postId/like', async (req, res, next) => {
  try {
    const postId = Number(req.params.postId);
    const authorId = await loadPostAuthor(postId);
    if (!authorId) return res.status(404).json({ error: 'post not found' });
    if (await isBlockedEitherWay(req.user.id, authorId)) return res.status(403).json({ error: 'not available' });

    await pool.query('INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, req.user.id]);
    await createNotification({ io: req.app.get('io'), recipientId: authorId, actorId: req.user.id, type: 'like', payload: { postId } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

postsRouter.delete('/:postId/like', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [req.params.postId, req.user.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// GET /api/posts/:postId/comments
postsRouter.get('/:postId/comments', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.body, c.created_at, u.id AS author_id, u.username AS author_username,
              u.display_name AS author_display_name, u.avatar_url AS author_avatar_url, u.is_founder AS author_is_founder,
              u.is_dev AS author_is_dev
       FROM post_comments c JOIN users u ON u.id = c.author_id
       WHERE c.post_id = $1
       ORDER BY c.created_at ASC`,
      [req.params.postId],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/posts/:postId/comments { body }
postsRouter.post('/:postId/comments', async (req, res, next) => {
  try {
    const postId = Number(req.params.postId);
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    if (!body) return res.status(400).json({ error: 'comment cannot be empty' });

    const authorId = await loadPostAuthor(postId);
    if (!authorId) return res.status(404).json({ error: 'post not found' });
    if (await isBlockedEitherWay(req.user.id, authorId)) return res.status(403).json({ error: 'not available' });

    const result = await pool.query(
      `INSERT INTO post_comments (post_id, author_id, body) VALUES ($1, $2, $3)
       RETURNING id, body, created_at`,
      [postId, req.user.id, body],
    );

    await createNotification({ io: req.app.get('io'), recipientId: authorId, actorId: req.user.id, type: 'comment', payload: { postId } });

    res.status(201).json({
      ...result.rows[0],
      author_id: req.user.id,
      author_username: req.user.username,
      author_display_name: req.user.display_name,
      author_avatar_url: req.user.avatar_url,
      author_is_founder: req.user.is_founder,
      author_is_dev: req.user.is_dev,
    });
  } catch (err) {
    next(err);
  }
});

postsRouter.delete('/comments/:commentId', async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM post_comments WHERE id = $1 AND author_id = $2 RETURNING id', [
      req.params.commentId,
      req.user.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'comment not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
