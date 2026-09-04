import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const { Pool } = pg;

// DATE columns (birthday) come back from pg as JS Date objects by default,
// which JSON.stringify to a full UTC datetime like
// "2026-09-04T00:00:00.000Z" -- that doesn't match the plain "YYYY-MM-DD"
// an <input type="date"> requires, so the field silently renders empty on
// the client even though the value saved fine. OID 1082 = date; keep it as
// the raw "YYYY-MM-DD" string pg already parsed off the wire.
pg.types.setTypeParser(1082, (val) => val);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '../../../database/schema.sql');

if (!process.env.DATABASE_URL) {
  console.error('missing DATABASE_URL env var. copy backend/.env.example to backend/.env and fill it in');
  process.exit(1);
}

// one shared pool, every route just borrows a connection from this.
function resolveSsl() {
  if (process.env.DATABASE_SSL === 'true') return { rejectUnauthorized: false };
  if (process.env.DATABASE_SSL === 'false') return false;
  const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
  return isLocal ? false : { rejectUnauthorized: false };
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolveSsl(),
});

// pg's own docs: this fires when an *idle* client the pool is holding onto
// errors out (most commonly a hosted db closing a connection nobody was
// using). pg already discards that client and opens a fresh one on the next
// checkout, so there's nothing left to recover from -- just log it.
pool.on('error', (err) => {
  console.error('idle postgres client error (pool recovers automatically):', err.message);
});

export async function testConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

// schema.sql is CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
// throughout, so running it against an already-populated database is a
// harmless no-op except for whatever's actually missing.
export async function ensureSchema() {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  await pool.query(sql);
}

// requireAuth only ever filters expired sessions out at read time -- it
// never deletes them. swept up on an interval from server.js instead of on
// every request, since this doesn't need to be instant.
export async function cleanupExpiredSessions() {
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
}

// every route's "get/update/delete by id" handler ends the same way: run the
// query, and if nothing came back, send a 404 instead of the row.
export async function queryOrNotFound(res, query, params, notFoundMessage) {
  const result = await pool.query(query, params);
  if (result.rows.length === 0) {
    res.status(404).json({ error: notFoundMessage });
    return null;
  }
  return result.rows[0];
}
