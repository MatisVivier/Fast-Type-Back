// routes/texts.js
import { Router } from 'express';
import pool from '../db.js';
import { randomWords } from '../textGen.js';

const router = Router();

// Route DB: récupère un texte aléatoire depuis PostgreSQL
router.get('/texts/random', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, content FROM texts ORDER BY RANDOM() LIMIT 1'
    );
    if (!rows.length) return res.json({ id: null, content: 'Aucune entrée en DB.' });
    res.json(rows[0]);
  } catch (e) {
    console.error('texts/random error:', e.code || e.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// NOUVELLE route: génère n mots aléatoires FR (pas de DB)
router.get('/texts/random-words', (req, res) => {
  const count = Math.max(1, Math.min(2000, parseInt(req.query.count || '80', 10)));
  const content = randomWords(count);
  res.json({ id: `words_${Date.now()}_${count}`, content });
});

export default router;
