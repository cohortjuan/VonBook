import { Router } from 'express';
import { pool } from '../db/pool.js';
import { getFriendIds, areFriends } from '../lib/friends.js';
import { isBlockedEitherWay } from '../lib/blocks.js';
import { createNotification } from '../lib/notify.js';
import { mediaUpload } from '../middleware/upload.js';
import { finalizeUpload } from '../lib/cloudinary.js';
import { normalizeUsername } from '../lib/normalize.js';
import { fetchLinkPreview } from '../lib/linkPreview.js';
import { extractMentionedUsernames } from '../lib/mentions.js';

export const postsRouter = Router();

const AUTHOR_COLUMNS = 'u.id AS author_id, u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar_url, u.is_founder AS author_is_founder, u.founder_title AS author_founder_title, u.is_dev AS author_is_dev';

// looks up which @usernames in `text` are real accounts (excluding
// whoever wrote it) and notifies each of them. addToPostMentions also
// adds a post_mentions row so the post shows up in their profile's
// Tagged section -- true for a post's own caption, false for a comment
// (a comment mention still notifies, it just isn't a "tagged post").
async function notifyMentions({ io, actorId, postId, text, addToPostMentions }) {
  const usernames = extractMentionedUsernames(text);
  if (usernames.length === 0) return;

  const result = await pool.query('SELECT id FROM users WHERE username = ANY($1) AND id <> $2 AND deleted_at IS NULL', [
    usernames,
    actorId,
  ]);

  for (const { id: mentionedId } of result.rows) {
    if (addToPostMentions) {
      await pool.query('INSERT INTO post_mentions (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, mentionedId]);
    }
    await createNotification({ io, recipientId: mentionedId, actorId, type: 'mention', payload: { postId } });
  }
}

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

// GET /api/posts/feed?before=<postId> -- your own posts + friends' posts +
// anyone's public post (see is_public on posts, routes/posts.js PATCH
// below), minus anything from someone blocked either direction, newest
// first, cursor-paginated by post id
postsRouter.get('/feed', async (req, res, next) => {
  try {
    const friendIds = await getFriendIds(req.user.id);
    const authorIds = [req.user.id, ...friendIds];
    const before = Number(req.query.before) || null;

    const result = await pool.query(
      `SELECT p.id, p.caption, p.game_tag, p.is_public, p.hidden_at, p.link_url, p.link_title, p.link_image_url, p.created_at, ${AUTHOR_COLUMNS}
       FROM posts p JOIN users u ON u.id = p.author_id
       WHERE (p.author_id = ANY($1) OR p.is_public = true) AND p.deleted_at IS NULL
         AND ($2::int IS NULL OR p.id < $2)
         AND (p.hidden_at IS NULL OR $4 = true)
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_id = $3 AND b.blocked_id = p.author_id)
              OR (b.blocker_id = p.author_id AND b.blocked_id = $3)
         )
       ORDER BY p.id DESC
       LIMIT 20`,
      [authorIds, before, req.user.id, req.user.is_dev],
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

    let publicOnly = false;
    if (author.id !== req.user.id) {
      if (await isBlockedEitherWay(req.user.id, author.id)) return res.status(404).json({ error: 'user not found' });
      publicOnly = !(await areFriends(req.user.id, author.id));
    }

    const result = await pool.query(
      `SELECT p.id, p.caption, p.game_tag, p.is_public, p.hidden_at, p.link_url, p.link_title, p.link_image_url, p.created_at, ${AUTHOR_COLUMNS}
       FROM posts p JOIN users u ON u.id = p.author_id
       WHERE p.author_id = $1 AND p.deleted_at IS NULL AND ($2::boolean IS FALSE OR p.is_public = true)
         AND (p.hidden_at IS NULL OR $3 = true)
       ORDER BY p.id DESC LIMIT 60`,
      [author.id, publicOnly, req.user.is_dev],
    );
    res.json(await attachMediaAndCounts(result.rows, req.user.id));
  } catch (err) {
    next(err);
  }
});

// GET /api/posts/tagged/:username -- posts where this person was
// @mentioned in the caption (see post_mentions), visible to the viewer
// under the exact same rule as the main feed: friends with the POST'S
// author, or the post is public -- friendship/visibility with the tagged
// person themself has nothing to do with it. show_tagged gates the whole
// section for anyone other than the tagged person looking at their own
// profile (see users.show_tagged).
postsRouter.get('/tagged/:username', async (req, res, next) => {
  try {
    const username = normalizeUsername(req.params.username);
    const userResult = await pool.query('SELECT id, show_tagged FROM users WHERE username = $1 AND deleted_at IS NULL', [
      username,
    ]);
    const taggedUser = userResult.rows[0];
    if (!taggedUser) return res.status(404).json({ error: 'user not found' });

    if (taggedUser.id !== req.user.id && !taggedUser.show_tagged) {
      return res.json([]);
    }

    const friendIds = await getFriendIds(req.user.id);
    const authorIds = [req.user.id, ...friendIds];

    const result = await pool.query(
      `SELECT p.id, p.caption, p.game_tag, p.is_public, p.hidden_at, p.link_url, p.link_title, p.link_image_url, p.created_at, ${AUTHOR_COLUMNS}
       FROM post_mentions pm
       JOIN posts p ON p.id = pm.post_id
       JOIN users u ON u.id = p.author_id
       WHERE pm.user_id = $1 AND p.deleted_at IS NULL
         AND (p.author_id = ANY($2) OR p.is_public = true)
         AND (p.hidden_at IS NULL OR $4 = true)
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_id = $3 AND b.blocked_id = p.author_id)
              OR (b.blocker_id = p.author_id AND b.blocked_id = $3)
         )
       ORDER BY p.id DESC LIMIT 60`,
      [taggedUser.id, authorIds, req.user.id, req.user.is_dev],
    );
    res.json(await attachMediaAndCounts(result.rows, req.user.id));
  } catch (err) {
    next(err);
  }
});

// POST /api/posts { caption, game_tag?, is_public?, link_url? } + up to 10 files under field "media"
postsRouter.post('/', mediaUpload.array('media', 10), async (req, res, next) => {
  try {
    const caption = typeof req.body.caption === 'string' ? req.body.caption.trim() : '';
    const gameTag = typeof req.body.game_tag === 'string' ? req.body.game_tag.trim().slice(0, 100) : '';
    const isPublic = req.body.is_public === 'true' || req.body.is_public === true;
    const files = req.files || [];

    let linkUrl = null;
    if (typeof req.body.link_url === 'string' && req.body.link_url.trim()) {
      try {
        linkUrl = new URL(req.body.link_url.trim()).href;
      } catch {
        return res.status(400).json({ error: 'that link doesn\'t look like a valid url' });
      }
    }

    if (!caption && files.length === 0 && !linkUrl) {
      return res.status(400).json({ error: 'a post needs a caption, a link, or at least one photo/video' });
    }

    // best-effort, never fails the post -- see lib/linkPreview.js
    const preview = linkUrl ? await fetchLinkPreview(linkUrl) : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const postResult = await client.query(
        `INSERT INTO posts (author_id, caption, game_tag, is_public, link_url, link_title, link_image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, caption, game_tag, is_public, link_url, link_title, link_image_url, created_at`,
        [req.user.id, caption || null, gameTag || null, isPublic, linkUrl, preview?.title || null, preview?.imageUrl || null],
      );
      const post = postResult.rows[0];

      for (let i = 0; i < files.length; i++) {
        const mediaType = files[i].mimetype.startsWith('video/') ? 'video' : 'image';
        const url = await finalizeUpload(files[i].path, `/uploads/${files[i].filename}`);
        await client.query(
          `INSERT INTO post_media (post_id, media_url, media_type, position) VALUES ($1, $2, $3, $4)`,
          [post.id, url, mediaType, i],
        );
      }

      await client.query('COMMIT');

      await notifyMentions({ io: req.app.get('io'), actorId: req.user.id, postId: post.id, text: caption, addToPostMentions: true });

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

// PATCH /api/posts/me/visibility { is_public } -- bulk version of the
// per-post toggle below, flips every one of the caller's own posts at
// once. a two-segment path so it can't collide with /:postId.
postsRouter.patch('/me/visibility', async (req, res, next) => {
  try {
    const isPublic = req.body.is_public === true || req.body.is_public === 'true';
    const result = await pool.query(
      `UPDATE posts SET is_public = $1 WHERE author_id = $2 AND deleted_at IS NULL RETURNING id`,
      [isPublic, req.user.id],
    );
    res.json({ updated: result.rowCount, is_public: isPublic });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/posts/:postId { is_public } -- author only, flips a post
// between friends-only (default) and visible in everyone's public feed
postsRouter.patch('/:postId', async (req, res, next) => {
  try {
    const isPublic = req.body.is_public === true || req.body.is_public === 'true';
    const result = await pool.query(
      `UPDATE posts SET is_public = $1 WHERE id = $2 AND author_id = $3 AND deleted_at IS NULL RETURNING id, is_public`,
      [isPublic, req.params.postId, req.user.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'post not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/posts/:postId -- author, or a dev account, soft delete.
// dev accounts can remove anyone's post (VonBot's included) -- a moderation
// backstop now that the feed can carry public posts and rss-sourced
// content neither of us actually vetted before it posted.
postsRouter.delete('/:postId', async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE posts SET deleted_at = now()
       WHERE id = $1 AND (author_id = $2 OR $3 = true) AND deleted_at IS NULL RETURNING id`,
      [req.params.postId, req.user.id, req.user.is_dev],
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

// POST /api/posts/:postId/report -- hides the post from everyone (see
// hidden_at) and notifies every dev account (see is_dev on users). one row
// per (post, reporter) in post_reports means a repeat tap from the same
// person is a silent no-op, not a duplicate notification or a re-hide.
postsRouter.post('/:postId/report', async (req, res, next) => {
  try {
    const postId = Number(req.params.postId);
    const authorResult = await pool.query(
      `SELECT p.author_id, u.username AS author_username
       FROM posts p JOIN users u ON u.id = p.author_id
       WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [postId],
    );
    const author = authorResult.rows[0];
    if (!author) return res.status(404).json({ error: 'post not found' });

    const inserted = await pool.query(
      'INSERT INTO post_reports (post_id, reporter_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id',
      [postId, req.user.id],
    );
    if (inserted.rows.length === 0) return res.status(204).end();

    // COALESCE so a second report on an already-hidden post doesn't reset
    // the original hidden_at timestamp
    await pool.query('UPDATE posts SET hidden_at = COALESCE(hidden_at, now()) WHERE id = $1', [postId]);

    const devs = await pool.query('SELECT id FROM users WHERE is_dev = true AND deleted_at IS NULL');
    const io = req.app.get('io');
    for (const { id: devId } of devs.rows) {
      await createNotification({
        io,
        recipientId: devId,
        actorId: req.user.id,
        type: 'report',
        payload: { postId, authorUsername: author.author_username },
      });
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /api/posts/:postId/release -- dev only, un-hides a reported post
// (see hidden_at). the other half of "hidden until a dev decides" is just
// the existing DELETE, which devs can already call on anyone's post.
postsRouter.post('/:postId/release', async (req, res, next) => {
  try {
    if (!req.user.is_dev) return res.status(403).json({ error: 'not allowed' });
    const result = await pool.query(
      'UPDATE posts SET hidden_at = NULL WHERE id = $1 AND deleted_at IS NULL RETURNING id',
      [req.params.postId],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'post not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

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

// GET /api/posts/:postId/comments -- flat list, parent_id null for a
// top-level comment. frontend groups replies under their parent (single
// level only, see parent_id's comment in database/schema.sql).
postsRouter.get('/:postId/comments', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.body, c.parent_id, c.created_at, u.id AS author_id, u.username AS author_username,
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

// POST /api/posts/:postId/comments { body, parent_id? }
postsRouter.post('/:postId/comments', async (req, res, next) => {
  try {
    const postId = Number(req.params.postId);
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    if (!body) return res.status(400).json({ error: 'comment cannot be empty' });

    const authorId = await loadPostAuthor(postId);
    if (!authorId) return res.status(404).json({ error: 'post not found' });
    if (await isBlockedEitherWay(req.user.id, authorId)) return res.status(403).json({ error: 'not available' });

    // replying to a reply collapses onto its top-level parent instead --
    // keeps threading to a single level, same as most apps that do this
    let parentId = Number(req.body.parent_id) || null;
    let parentAuthorId = null;
    if (parentId) {
      const parent = await pool.query('SELECT id, parent_id, author_id FROM post_comments WHERE id = $1 AND post_id = $2', [
        parentId,
        postId,
      ]);
      if (!parent.rows[0]) return res.status(404).json({ error: 'comment not found' });
      parentId = parent.rows[0].parent_id || parent.rows[0].id;
      parentAuthorId = parent.rows[0].author_id;
    }

    const result = await pool.query(
      `INSERT INTO post_comments (post_id, author_id, body, parent_id) VALUES ($1, $2, $3, $4)
       RETURNING id, body, parent_id, created_at`,
      [postId, req.user.id, body, parentId],
    );

    const io = req.app.get('io');
    await createNotification({ io, recipientId: authorId, actorId: req.user.id, type: 'comment', payload: { postId } });
    if (parentAuthorId && parentAuthorId !== authorId) {
      await createNotification({ io, recipientId: parentAuthorId, actorId: req.user.id, type: 'comment', payload: { postId } });
    }
    await notifyMentions({ io, actorId: req.user.id, postId, text: body, addToPostMentions: false });

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

// author, or a dev account, same reasoning as the post delete above
postsRouter.delete('/comments/:commentId', async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM post_comments WHERE id = $1 AND (author_id = $2 OR $3 = true) RETURNING id',
      [req.params.commentId, req.user.id, req.user.is_dev],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'comment not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
