import { Router } from 'express';
import pool from '../db.js';
import jwt from 'jsonwebtoken';
import { gainSolo } from '../xp.js';
import { levelFromXp, coinsEarnedBetweenLevels } from '../services/progression.js';

const router = Router();
const COOKIE_NAME = process.env.COOKIE_NAME || 'ta_session';
const JWT_SECRET  = process.env.JWT_SECRET  || 'dev_secret';

// Enregistre l'XP ET la run solo, et crédite les pièces selon le niveau
router.post('/solo/finish', async (req, res) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return res.json({ error: 'not_authenticated' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.sub;

    const stats = req.body?.stats ? req.body.stats : req.body;
    let { wpm = 0, acc = 1, typed = 0, correct = 0, errors = 0, elapsed = 0 } = stats || {};

    // Normalisation
    wpm     = Math.max(0, Math.round(Number(wpm)));
    typed   = Math.max(0, Math.round(Number(typed)));
    correct = Math.max(0, Math.round(Number(correct)));
    errors  = Math.max(0, Math.round(Number(errors)));
    elapsed = Math.max(0, Math.round(Number(elapsed)));
    acc     = Math.max(0, Math.min(1, Number(acc))); // 0..1

    // 1) Insérer la run
    await pool.query(
      `INSERT INTO solo_runs (user_id, wpm, acc, typed, correct, errors, elapsed_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, wpm, acc, typed, correct, errors, elapsed]
    );

    // 2) Calcul du gain d'XP
    const xpGain = gainSolo({ wpm, acc, typed, correct, errors, elapsed });

    // 3) Transaction: récupérer ancien XP, calculer niveaux & pièces, mettre à jour
    await pool.query('BEGIN');

    const { rows: r0 } = await pool.query(
      `SELECT xp, coin_balance FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    const oldXp   = r0?.[0]?.xp ?? 0;
    const oldLvl  = levelFromXp(oldXp).level;
    const newXp   = oldXp + xpGain;
    const newLvl  = levelFromXp(newXp).level;
    const coins   = coinsEarnedBetweenLevels(oldLvl, newLvl);

    const { rows: r1 } = await pool.query(
      `UPDATE users
         SET xp = $1,
             coin_balance = coin_balance + $2
       WHERE id = $3
       RETURNING xp, coin_balance`,
      [newXp, coins, userId]
    );

    await pool.query('COMMIT');

    res.json({
      ok: true,
      xpGained: xpGain,
      xpTotal: r1?.[0]?.xp ?? newXp,
      coinsAwarded: coins,
      coinBalance: r1?.[0]?.coin_balance ?? null,
      levelBefore: oldLvl,
      levelAfter: newLvl,
    });
  } catch (e) {
    console.error(e);
    try { await pool.query('ROLLBACK'); } catch {}
    res.json({ error: 'solo_xp_failed' });
  }
});

export default router;
