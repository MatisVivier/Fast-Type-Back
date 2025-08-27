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
  } catch { return null; }
}

// 5 derniers matchs (tu as déjà /account/matches, on laisse tel quel)

// Stats classé globales
router.get('/account/ranked-stats', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });

  const [rows] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) AS wins,
       SUM(CASE WHEN winner_id IS NULL THEN 1 ELSE 0 END) AS draws,
       AVG(CASE WHEN p1_id = ? THEN p1_acc ELSE p2_acc END) AS avg_acc,
       AVG(CASE WHEN p1_id = ? THEN p1_wpm ELSE p2_wpm END) AS avg_wpm
     FROM matches
     WHERE p1_id = ? OR p2_id = ?`,
    [uid, uid, uid, uid, uid]
  );
  const r = rows[0] || {};
  const total = Number(r.total || 0);
  const wins = Number(r.wins || 0);
  const draws = Number(r.draws || 0);
  const losses = Math.max(0, total - wins - draws);
  res.json({
    ok: true,
    total, wins, losses, draws,
    avgAcc: r.avg_acc != null ? Number(r.avg_acc) : null,   // 0..1
    avgWpm: r.avg_wpm != null ? Math.round(r.avg_wpm) : null
  });
});

// Stats solo globales
router.get('/account/solo-stats', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });

  const [rows] = await pool.query(
    `SELECT
       COUNT(*) AS runs,
       ROUND(AVG(wpm)) AS avg_wpm,
       AVG(acc) AS avg_acc,
       SUM(correct) AS sum_correct,
       SUM(typed)   AS sum_typed,
       SUM(errors)  AS sum_errors,
       SUM(elapsed_ms) AS total_ms
     FROM solo_runs
     WHERE user_id = ?`,
    [uid]
  );
  const r = rows[0] || {};
  const runs = Number(r.runs || 0);
  const avgWpm = r.avg_wpm != null ? Number(r.avg_wpm) : null;
  const avgAcc = r.avg_acc != null ? Number(r.avg_acc) : null; // 0..1
  const wordsTyped = Math.round((Number(r.sum_correct || 0)) / 5); // approx mots = correct/5

  res.json({
    ok: true,
    runs,
    avgWpm,
    avgAcc,
    wordsTyped,
    totalMs: Number(r.total_ms || 0)
  });
});

router.get('/account/matches', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });

  // force un entier sûr (et on l'injecte en LITERAL, pas paramètre)
  const limit = Math.min(5, Math.max(1, parseInt(req.query.limit, 10) || 5));

  const sql = `
    SELECT
      id, created_at,
      p1_id, p2_id, p1_username, p2_username,
      p1_wpm, p2_wpm, p1_acc, p2_acc,
      p1_rating_before, p1_rating_after,
      p2_rating_before, p2_rating_after,
      winner_id, reason, elapsed_ms
    FROM matches
    WHERE (p1_id = ? OR p2_id = ?)
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `;
  try {
    const [rows] = await pool.query(sql, [uid, uid]);
    res.json({ ok: true, matches: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'matches_query_failed' });
  }
});


export default router;
