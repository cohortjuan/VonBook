-- VonBook db schema
-- runs automatically when the docker container first spins up,
-- or run it yourself with: psql "$DATABASE_URL" -f database/schema.sql

BEGIN;

-- ---------------------------------------------------------------------
-- users: one login = one profile. username is the @handle used for
-- friend search and mentions; email is used for login + contact matching.
-- Both are always stored + compared lowercased at the app level (see
-- backend/src/lib/normalize.js), same reasoning as Whispers App: keeps
-- this schema extension-free instead of relying on citext.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                     SERIAL PRIMARY KEY,
  email                  VARCHAR(255) NOT NULL UNIQUE,
  username               VARCHAR(30) NOT NULL UNIQUE,
  phone                  VARCHAR(20) UNIQUE,
  password_hash          TEXT NOT NULL,
  display_name           VARCHAR(100) NOT NULL,
  bio                    TEXT,
  avatar_url             TEXT,
  cover_url              TEXT,
  birthday               DATE,
  -- the birthday boy's own account, claimed once at signup with
  -- FOUNDER_CLAIM_CODE (see backend/src/routes/auth.js). the partial
  -- unique index below guarantees at most one row can ever have this set,
  -- so the claim code can never mint a second "founder".
  is_founder             BOOLEAN NOT NULL DEFAULT false,
  founder_title          VARCHAR(100),
  -- the person who actually built this app -- a plain badge (gold ring on
  -- the avatar, see frontend/src/components/Avatar.jsx), not claimed via
  -- any code like is_founder. no uniqueness enforced: unlike the founder
  -- slot this was never meant to be scarce, just unlikely to ever apply
  -- to more than one row in practice.
  is_dev                 BOOLEAN NOT NULL DEFAULT false,
  -- "currently playing" status, gamer-hub feature -- free text (not tied
  -- to any game database), shown as a badge on the profile and in friend
  -- lists. null/empty means not shown at all.
  now_playing            VARCHAR(100),
  failed_login_attempts  INTEGER NOT NULL DEFAULT 0,
  locked_until           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_one_founder ON users ((is_founder)) WHERE is_founder = true;
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------
-- is_dev was added to the users table above *after* this schema had
-- already been deployed once. CREATE TABLE IF NOT EXISTS is a complete
-- no-op against a table that already exists -- it does NOT add new
-- columns to it, so a database that ran ensureSchema() before is_dev
-- existed here would never actually get the column, and every query that
-- selects it (basically any profile fetch) would start throwing "column
-- does not exist" -- exactly the bug that shipped once already (see
-- git history). ADD COLUMN IF NOT EXISTS is the one form that's correct
-- both for a brand-new database (already has it from the CREATE TABLE
-- above, this is a no-op) and one that predates this column (this is
-- what actually adds it).
-- ---------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_dev BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------
-- sessions: opaque random tokens, hashed at rest, revocable by deleting
-- the row -- same reasoning as Whispers App (see that project's
-- database/schema.sql for the long version of this comment).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  csrf_token   TEXT NOT NULL,
  user_agent   TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- ---------------------------------------------------------------------
-- password_resets: same opaque-token-hashed-at-rest pattern as sessions
-- above. One-time use (used_at set the moment it's redeemed, checked
-- atomically in the same UPDATE that redeems it -- see routes/auth.js) and
-- expires on its own regardless. A user can have several outstanding rows
-- if they hit "forgot password" more than once -- only ever the one they
-- actually click through ever gets used, the rest just expire unused.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);

-- ---------------------------------------------------------------------
-- friendships: one row per pair, direction only matters for who has to
-- accept. LEAST/GREATEST unique index below stops a user from ever having
-- two rows with the same other person (a stray double request, or a
-- request crossing an already-accepted row).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS friendships (
  id            SERIAL PRIMARY KEY,
  requester_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at  TIMESTAMPTZ,
  CONSTRAINT no_self_friend CHECK (requester_id <> addressee_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_pair
  ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id, status);

-- ---------------------------------------------------------------------
-- blocks: one-directional and independent of friendships. Every query
-- that shows another user's posts, profile, or lets a message through
-- checks this table both directions -- see requireNotBlocked() in
-- backend/src/lib/blocks.js. Blocking (or deleting a friend) is what
-- "severs all connections" means in this app: it deletes the friendships
-- row (see routes/friends.js) and, via this table, blocks re-adding,
-- messaging, and feed visibility both ways.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blocks (
  id          SERIAL PRIMARY KEY,
  blocker_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_self_block CHECK (blocker_id <> blocked_id),
  CONSTRAINT unique_block UNIQUE (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocked_id ON blocks(blocked_id);

-- ---------------------------------------------------------------------
-- posts / post_media / post_likes / post_comments: the Instagram-style
-- feed. A post can carry multiple media rows (a carousel) or none (a
-- text-only status).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
  id          SERIAL PRIMARY KEY,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caption     TEXT,
  -- optional game name for an achievement/gameplay post -- just a free
  -- text tag, not a foreign key into any game catalog. set, it renders a
  -- trophy badge on the post (see frontend/src/components/PostCard.jsx).
  game_tag    VARCHAR(100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

-- added after the table already existed in production -- see the comment
-- on the same pattern above the messages table's media_url/media_type.
-- defaults to false: a post is friends-only unless its author explicitly
-- opts it into the public feed (see routes/posts.js).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

-- set the moment a post gets its first report, cleared by a dev "release"
-- (see routes/posts.js) -- a hidden post is invisible to everyone,
-- including its own author, until a dev either releases or deletes it.
-- null = visible, same nullable-timestamp-as-flag pattern as deleted_at.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

-- a post can carry a link instead of (or alongside) photos/videos --
-- link_title/link_image_url are a best-effort Open Graph scrape done once
-- at post time (see lib/linkPreview.js), never re-fetched afterward. a
-- link with no discoverable og:image just renders with the vonbook logo
-- instead (see PostCard.jsx) -- link_image_url stays null in that case.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS link_url TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS link_title TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS link_image_url TEXT;

-- rss item ids/links VonBot has already reposted (see lib/vonbot.js), so a
-- tick that sees the same feed item twice skips it instead of
-- double-posting.
CREATE TABLE IF NOT EXISTS vonbot_seen (
  source_id   TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_author_created ON posts(author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS post_media (
  id          SERIAL PRIMARY KEY,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_url   TEXT NOT NULL,
  media_type  VARCHAR(10) NOT NULL CHECK (media_type IN ('image', 'video')),
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_post_media_post_id ON post_media(post_id);

CREATE TABLE IF NOT EXISTS post_likes (
  id          SERIAL PRIMARY KEY,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON post_likes(post_id);

CREATE TABLE IF NOT EXISTS post_comments (
  id          SERIAL PRIMARY KEY,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON post_comments(post_id, created_at);

-- single-level threading only (a reply can't itself be replied to) -- see
-- routes/posts.js and the comment rendering in PostCard.jsx
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES post_comments(id) ON DELETE CASCADE;

-- one row per (post, reporter) so repeat taps on the report button don't
-- spam every dev account with duplicate notifications -- see routes/posts.js
CREATE TABLE IF NOT EXISTS post_reports (
  id          SERIAL PRIMARY KEY,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, reporter_id)
);

-- ---------------------------------------------------------------------
-- linked_accounts: other platforms a user has told VonBook about (a
-- handle/link they typed in themselves -- not a real oauth connection,
-- see backend/src/routes/linked-accounts.js for why). Covers both social
-- apps (facebook/instagram/tiktok/snapchat) and gamertags (psn/xbox/pc)
-- -- same mechanism either way, just a handle + optional profile link.
-- One row per platform per user.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS linked_accounts (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform    VARCHAR(20) NOT NULL CHECK (platform IN ('facebook', 'instagram', 'tiktok', 'snapchat', 'psn', 'xbox', 'pc', 'other')),
  handle      VARCHAR(200) NOT NULL,
  url         TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform)
);

-- ---------------------------------------------------------------------
-- conversations / conversation_participants / messages: dm + group chat.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id          SERIAL PRIMARY KEY,
  is_group    BOOLEAN NOT NULL DEFAULT false,
  title       VARCHAR(100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id  INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at     TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON conversation_participants(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id               SERIAL PRIMARY KEY,
  conversation_id  INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);

-- added after the table already existed in production -- ADD COLUMN IF NOT
-- EXISTS makes this a harmless no-op there too, same as the CREATE TABLE IF
-- NOT EXISTS statements above (see db/pool.js's ensureSchema, which reruns
-- this whole file on every boot).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type VARCHAR(10) CHECK (media_type IN ('image', 'video'));

-- ON DELETE SET NULL, not CASCADE: there's no message-delete feature, but
-- if one's ever added, a reply should just lose its quote rather than
-- disappear along with whatever it was replying to.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);

-- ---------------------------------------------------------------------
-- calls: a log entry per call attempt. The actual audio/video never
-- touches this server -- see backend/src/sockets/index.js, which only
-- relays webrtc signaling messages peer-to-peer.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calls (
  id               SERIAL PRIMARY KEY,
  conversation_id  INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  caller_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_type        VARCHAR(10) NOT NULL CHECK (call_type IN ('audio', 'video')),
  status           VARCHAR(10) NOT NULL DEFAULT 'missed' CHECK (status IN ('missed', 'completed', 'declined')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_calls_conversation_id ON calls(conversation_id);

-- ---------------------------------------------------------------------
-- notifications: powers the bell icon. payload is a small json blob
-- shaped per type (e.g. { postId } for a like, { platform, message } for
-- a platform_ping) -- see backend/src/lib/notify.js for the one place
-- that writes these.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id            SERIAL PRIMARY KEY,
  recipient_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type          VARCHAR(20) NOT NULL CHECK (
                  type IN ('friend_request', 'friend_accept', 'like', 'comment', 'message', 'platform_ping', 'missed_call')
                ),
  payload       JSONB,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created ON notifications(recipient_id, created_at DESC);

COMMIT;
