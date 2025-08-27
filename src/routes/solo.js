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
    let { wpm = 0, acc = 1, typed = 0, correct = 0, errors = 0, elapsed = 0 } = stats || {};

    // Normalisation / bornes simples
    wpm     = Math.max(0, Math.round(Number(wpm)));
    typed   = Math.max(0, Math.round(Number(typed)));
    correct = Math.max(0, Math.round(Number(correct)));
    errors  = Math.max(0, Math.round(Number(errors)));
    elapsed = Math.max(0, Math.round(Number(elapsed)));
    acc     = Math.max(0, Math.min(1, Number(acc))); // 0..1

    // Insert la run (PostgreSQL)
    await pool.query(
      `INSERT INTO solo_runs (user_id, wpm, acc, typed, correct, errors, elapsed_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, wpm, acc, typed, correct, errors, elapsed]
    );

    // Calcul & update XP (PostgreSQL) + récup direct du total via RETURNING
    const xp = gainSolo({ wpm, acc, typed, correct, errors, elapsed });
    const { rows } = await pool.query(
      `UPDATE users
         SET xp = xp + $1
       WHERE id = $2
       RETURNING xp`,
      [xp, userId]
    );

    const xpTotal = rows?.[0]?.xp ?? null;

    res.json({ ok: true, xpGained: xp, xpTotal });
  } catch (e) {
    console.error(e);
    res.json({ error: 'solo_xp_failed' });
  }
});

export default router;
