import { Router } from 'express';
import pool from '../db.js';
import jwt from 'jsonwebtoken';
import { gainSolo } from '../xp.js';

const router = Router();
const COOKIE_NAME = process.env.COOKIE_NAME || 'ta_session';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// Enregistre l'XP ET la run solo
router.post('/solo/finish', async (req, res) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return res.json({ error: 'not_authenticated' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.sub;

    const stats = req.body?.stats ? req.body.stats : req.body;
    const { wpm=0, acc=1, typed=0, correct=0, errors=0, elapsed=0 } = stats || {};

    // Insert la run
    await pool.query(
      `INSERT INTO solo_runs (user_id, wpm, acc, typed, correct, errors, elapsed_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, Math.round(wpm), Number(acc), Math.round(typed), Math.round(correct), Math.round(errors), Math.round(elapsed)]
    );

    // XP
    const xp = gainSolo(stats || {});
    await pool.query('UPDATE users SET xp = xp + ? WHERE id = ?', [xp, userId]);
    const [[row]] = await pool.query('SELECT xp FROM users WHERE id = ? LIMIT 1', [userId]);

    res.json({ ok: true, xpGained: xp, xpTotal: row?.xp ?? null });
  } catch (e) {
    console.error(e);
    res.json({ error: 'solo_xp_failed' });
  }
});

export default router;
