// server/services/friends.js
import pool from '../db.js';

export async function searchUsersByUsername(q, selfId, limit = 10) {
  const { rows } = await pool.query(
    `
    WITH relations AS (
      SELECT LEAST(user_a, user_b) AS la, GREATEST(user_a, user_b) AS gb
      FROM friendships
      WHERE user_a = $2 OR user_b = $2
    ), blocked AS (
      SELECT from_user_id, to_user_id FROM friend_requests
      WHERE status = 'pending' AND (from_user_id = $2 OR to_user_id = $2)
    )
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
    LIMIT $3
    `,
    [q, selfId, limit]
  );
  return rows;
}

export async function getPendingRequests(userId) {
  const { rows } = await pool.query(
    `
    SELECT r.id, r.created_at, r.status,
           r.from_user_id, fu.username AS from_username, fu.avatar_url AS from_avatar,
           r.to_user_id, tu.username   AS to_username,   tu.avatar_url   AS to_avatar
    FROM friend_requests r
    JOIN users fu ON fu.id = r.from_user_id
    JOIN users tu ON tu.id = r.to_user_id
    WHERE (r.to_user_id = $1 OR r.from_user_id = $1)
      AND r.status = 'pending'
    ORDER BY r.created_at DESC
    `,
    [userId]
  );
  return rows;
}

export async function sendFriendRequest(fromId, toId) {
  return await pool.tx(async client => {
    // Déjà amis ?
    const fr = await client.query(
      `SELECT 1 FROM friendships WHERE (user_a=$1 AND user_b=$2) OR (user_a=$2 AND user_b=$1) LIMIT 1`,
      [fromId, toId]
    );
    if (fr.rowCount) return { alreadyFriends: true };

    // Existe une pending dans un sens ?
    const pending = await client.query(
      `SELECT id, from_user_id, to_user_id FROM friend_requests
       WHERE status='pending' AND
             ((from_user_id=$1 AND to_user_id=$2) OR (from_user_id=$2 AND to_user_id=$1))
       LIMIT 1`,
      [fromId, toId]
    );

    if (pending.rowCount) {
      // Si l’autre a déjà envoyé -> auto-accept
      const existing = pending.rows[0];
      if (existing.from_user_id === toId && existing.to_user_id === fromId) {
        await client.query(`UPDATE friend_requests SET status='accepted' WHERE id=$1`, [existing.id]);
        await client.query(
          `INSERT INTO friendships(user_a, user_b) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [fromId, toId]
        );
        return { autoAccepted: true, requestId: existing.id };
      }
      // Sinon, rien à faire
      return { alreadyPending: true, requestId: existing.id };
    }

    // Créer la demande
    const ins = await client.query(
      `INSERT INTO friend_requests(from_user_id, to_user_id, status)
       VALUES ($1, $2, 'pending') RETURNING id, created_at`,
      [fromId, toId]
    );
    return { requestId: ins.rows[0].id, created_at: ins.rows[0].created_at };
  });
}

export async function acceptRequest(requestId, userId) {
  return await pool.tx(async client => {
    // Vérifier que la demande m’est adressée et pending
    const { rows, rowCount } = await client.query(
      `SELECT id, from_user_id, to_user_id, status FROM friend_requests WHERE id=$1 LIMIT 1`,
      [requestId]
    );
    if (!rowCount) return { notFound: true };
    const req = rows[0];
    if (req.to_user_id !== userId) return { forbidden: true };
    if (req.status !== 'pending') return { alreadyHandled: true };

    // Marquer acceptée + créer l’amitié
    await client.query(`UPDATE friend_requests SET status='accepted' WHERE id=$1`, [requestId]);
    await client.query(
      `INSERT INTO friendships(user_a, user_b) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [req.from_user_id, req.to_user_id]
    );
    return { ok: true, friendId: req.from_user_id };
  });
}

export async function declineRequest(requestId, userId) {
  const { rows, rowCount } = await pool.query(
    `UPDATE friend_requests
     SET status='declined'
     WHERE id=$1 AND to_user_id=$2 AND status='pending'
     RETURNING id`,
    [requestId, userId]
  );
  if (!rowCount) return { notFoundOrForbidden: true };
  return { ok: true };
}

export async function cancelRequest(requestId, userId) {
  const { rowCount } = await pool.query(
    `UPDATE friend_requests
     SET status='cancelled'
     WHERE id=$1 AND from_user_id=$2 AND status='pending'`,
    [requestId, userId]
  );
  return { ok: rowCount > 0 };
}

export async function listFriends(userId) {
  const { rows } = await pool.query(
    `
    SELECT other.id, other.username, other.avatar_url, other.rating, other.xp
    FROM friendships f
    JOIN users other
      ON other.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
    WHERE f.user_a = $1 OR f.user_b = $1
    ORDER BY other.username ASC
    `,
    [userId]
  );
  return rows;
}

export async function removeFriend(userId, otherId) {
  const { rowCount } = await pool.query(
    `DELETE FROM friendships
     WHERE (user_a=$1 AND user_b=$2) OR (user_a=$2 AND user_b=$1)`,
    [userId, otherId]
  );
  return { ok: rowCount > 0 };
}

export async function getPublicProfile(userId) {
  // Stats basées sur ta table matches (adapte si noms différents)
  const { rows } = await pool.query(
    `
    SELECT
      u.id, u.username, u.avatar_url, u.rating, u.xp, u.created_at,
      COALESCE(stats.total,0) AS total_matches,
      COALESCE(stats.wins,0)  AS wins,
      COALESCE(stats.draws,0) AS draws,
      COALESCE(stats.avg_wpm,0)::int AS avg_wpm,
      COALESCE(stats.avg_acc,0)::float AS avg_acc
    FROM users u
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN winner_id = $1 THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN winner_id IS NULL THEN 1 ELSE 0 END) AS draws,
        AVG(
          CASE WHEN p1_id = $1 THEN p1_wpm
               WHEN p2_id = $1 THEN p2_wpm
          END
        ) AS avg_wpm,
        AVG(
          CASE WHEN p1_id = $1 THEN p1_acc
               WHEN p2_id = $1 THEN p2_acc
          END
        ) AS avg_acc
      FROM matches
      WHERE (p1_id = $1 OR p2_id = $1)
    ) stats ON true
    WHERE u.id = $1
    LIMIT 1
    `,
    [userId]
  );
  return rows[0] || null;
}
