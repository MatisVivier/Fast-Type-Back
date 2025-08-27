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

// ------------------------- Stats classé globales -------------------------
router.get('/account/ranked-stats', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });

  try {
    const { rows } = await pool.query(
      `
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN winner_id = $1 THEN 1 ELSE 0 END)::int AS wins,
        SUM(CASE WHEN winner_id IS NULL THEN 1 ELSE 0 END)::int AS draws,
        AVG(CASE WHEN p1_id = $1 THEN p1_acc ELSE p2_acc END)      AS avg_acc,
        AVG(CASE WHEN p1_id = $1 THEN p1_wpm ELSE p2_wpm END)      AS avg_wpm
      FROM matches
      WHERE p1_id = $1 OR p2_id = $1
      `,
      [uid]
    );

    const r = rows[0] || {};
    const total = Number(r.total || 0);
    const wins = Number(r.wins || 0);
    const draws = Number(r.draws || 0);
    const losses = Math.max(0, total - wins - draws);

    res.json({
      ok: true,
      total, wins, losses, draws,
      // avg_acc stocké en 0..1 ? on renvoie Number ou null
      avgAcc: r.avg_acc != null ? Number(r.avg_acc) : null,
      avgWpm: r.avg_wpm != null ? Math.round(Number(r.avg_wpm)) : null
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'ranked_stats_query_failed' });
  }
});

// -------------------------- Stats solo globales --------------------------
router.get('/account/solo-stats', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });

  try {
    const { rows } = await pool.query(
      `
      SELECT
        COUNT(*)::int                 AS runs,
        ROUND(AVG(wpm))               AS avg_wpm,
        AVG(acc)                      AS avg_acc,
        SUM(correct)                  AS sum_correct,
        SUM(typed)                    AS sum_typed,
        SUM(errors)                   AS sum_errors,
        SUM(elapsed_ms)               AS total_ms
      FROM solo_runs
      WHERE user_id = $1
      `,
      [uid]
    );

    const r = rows[0] || {};
    const runs     = Number(r.runs || 0);
    const avgWpm   = r.avg_wpm != null ? Number(r.avg_wpm) : null;
    const avgAcc   = r.avg_acc != null ? Number(r.avg_acc) : null; // 0..1
    const wordsTyped = Math.round(Number(r.sum_correct || 0) / 5);  // approx

    res.json({
      ok: true,
      runs,
      avgWpm,
      avgAcc,
      wordsTyped,
      totalMs: Number(r.total_ms || 0)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'solo_stats_query_failed' });
  }
});

// --------------------------- 5 derniers matchs ---------------------------
router.get('/account/matches', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });

  // On sécurise LIMIT côté serveur (entier 1..5)
  const limit = Math.min(5, Math.max(1, parseInt(req.query.limit, 10) || 5));

  // Avec Postgres, LIMIT peut aussi être paramétré via $n, mais interpolation est OK ici
  // car 'limit' est borné et converti en entier juste au-dessus.
  const sql = `
    SELECT
      id, created_at,
      p1_id, p2_id, p1_username, p2_username,
      p1_wpm, p2_wpm, p1_acc, p2_acc,
      p1_rating_before, p1_rating_after,
      p2_rating_before, p2_rating_after,
      winner_id, reason, elapsed_ms
    FROM matches
    WHERE (p1_id = $1 OR p2_id = $1)
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `;

  try {
    const { rows } = await pool.query(sql, [uid]);
    res.json({ ok: true, matches: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'matches_query_failed' });
  }
});

export default router;
