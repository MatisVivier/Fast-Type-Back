// server/routes/friends.js
console.log('[friends] routes file loaded');
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db.js';

const router = Router();
const COOKIE_NAME = process.env.COOKIE_NAME || 'ta_session';
const JWT_SECRET  = process.env.JWT_SECRET  || 'dev_secret';

function authUserId(req) {
  try {
    const tok = req.cookies?.[COOKIE_NAME];
    if (!tok) return null;
    const decoded = jwt.verify(tok, JWT_SECRET);
    return decoded.sub || null;
  } catch {
    return null;
  }
}

/**
 * GET /api/friends/search?q=xxx
 * Retourne des utilisateurs dont le username commence par q,
 * en excluant soi-même, les déjà amis, et les pending requests.
 */
router.get('/friends/search', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });

  const q = (req.query.q || '').trim();
  if (!q) return res.json({ items: [] });

  try {
    const { rows } = await pool.query(
      `
      SELECT u.id, u.username, u.avatar_url, u.rating, u.xp
      FROM users u
      WHERE u.id <> $2
        AND u.username ILIKE $1 || '%'
        AND NOT EXISTS (
          SELECT 1 FROM friendships f
          WHERE (f.user_a = u.id AND f.user_b = $2) OR (f.user_b = u.id AND f.user_a = $2)
        )
        AND NOT EXISTS (
          SELECT 1 FROM friend_requests r
          WHERE r.status = 'pending' AND
                ((r.from_user_id = $2 AND r.to_user_id = u.id) OR (r.from_user_id = u.id AND r.to_user_id = $2))
        )
      ORDER BY u.username ASC
      LIMIT 10
      `,
      [q, uid]
    );
    res.json({ items: rows });
  } catch (e) {
    console.error('friends/search error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * (Optionnel mais utile) GET /api/friends
 * Liste des amis pour la sidebar.
 */
router.get('/friends', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });

  try {
    const { rows } = await pool.query(
      `
      SELECT other.id, other.username, other.avatar_url, other.rating, other.xp
      FROM friendships f
      JOIN users other
        ON other.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
      WHERE f.user_a = $1 OR f.user_b = $1
      ORDER BY other.username ASC
      `,
      [uid]
    );
    res.json({ items: rows });
  } catch (e) {
    console.error('friends list error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * (Optionnel minimal) GET /api/friends/requests
 * pour que ta page ne plante pas.
 */
router.get('/friends/requests', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });

  try {
    const { rows } = await pool.query(
      `
      SELECT r.id, r.created_at, r.status,
             r.from_user_id, fu.username AS from_username,
             r.to_user_id,   tu.username AS to_username
      FROM friend_requests r
      JOIN users fu ON fu.id = r.from_user_id
      JOIN users tu ON tu.id = r.to_user_id
      WHERE (r.to_user_id = $1 OR r.from_user_id = $1)
        AND r.status = 'pending'
      ORDER BY r.created_at DESC
      `,
      [uid]
    );
    res.json({ items: rows });
  } catch (e) {
    console.error('friends requests error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * (Optionnel minimal) POST /api/friends/requests
 * Envoie une invitation via to_user_id (correspond à ton front actuel).
 */
router.post('/friends/requests', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });

  const { to_user_id } = req.body || {};
  if (!to_user_id || to_user_id === uid) {
    return res.status(400).json({ error: 'invalid_target' });
  }

  try {
    // déjà amis ?
    const already = await pool.query(
      `SELECT 1 FROM friendships WHERE (user_a=$1 AND user_b=$2) OR (user_a=$2 AND user_b=$1) LIMIT 1`,
      [uid, to_user_id]
    );
    if (already.rowCount) return res.status(409).json({ error: 'already_friends' });

    // demande opposée déjà pending ? => auto-accept
    const pend = await pool.query(
      `SELECT id FROM friend_requests
       WHERE status='pending' AND from_user_id=$2 AND to_user_id=$1
       LIMIT 1`,
      [uid, to_user_id]
    );
    if (pend.rowCount) {
      const rid = pend.rows[0].id;
      await pool.query(`UPDATE friend_requests SET status='accepted' WHERE id=$1`, [rid]);
      await pool.query(
        `INSERT INTO friendships(user_a, user_b)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [uid, to_user_id]
      );
      return res.json({ ok: true, autoAccepted: true, request_id: rid });
    }

    // existe déjà une pending dans le même sens ?
    const pendSame = await pool.query(
      `SELECT id FROM friend_requests
       WHERE status='pending' AND from_user_id=$1 AND to_user_id=$2
       LIMIT 1`,
      [uid, to_user_id]
    );
    if (pendSame.rowCount) {
      return res.status(409).json({ error: 'already_pending', request_id: pendSame.rows[0].id });
    }

    // sinon créer la demande
    const ins = await pool.query(
      `INSERT INTO friend_requests(from_user_id, to_user_id, status)
       VALUES ($1, $2, 'pending') RETURNING id, created_at`,
      [uid, to_user_id]
    );
    res.json({ ok: true, request_id: ins.rows[0].id, created_at: ins.rows[0].created_at });
  } catch (e) {
    console.error('send request error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
