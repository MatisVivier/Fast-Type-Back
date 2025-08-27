// server/routes/wallet.js
import { Router } from 'express';
import pool from '../db.js';
import jwt from 'jsonwebtoken';

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

router.get('/account/wallet', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });
  const { rows } = await pool.query('SELECT coin_balance FROM users WHERE id = $1', [uid]);
  res.json({ coin_balance: rows[0]?.coin_balance ?? 0 });
});

router.get('/account/wallet/ledger', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });
  const { rows } = await pool.query(
    'SELECT id, delta, reason, meta, created_at FROM coin_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
    [uid]
  );
  res.json({ ledger: rows });
});

// À utiliser plus tard: dépense (shop)
router.post('/account/wallet/spend', express.json(), async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });

  const { amount, reason, meta } = req.body || {};
  const cost = parseInt(amount, 10) || 0;
  if (cost <= 0) return res.status(400).json({ error: 'bad_amount' });

  // transaction simple
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT coin_balance FROM users WHERE id = $1 FOR UPDATE', [uid]);
    const bal = rows[0]?.coin_balance ?? 0;
    if (bal < cost) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'insufficient_funds' });
    }
    const newBal = bal - cost;
    await client.query('UPDATE users SET coin_balance = $1 WHERE id = $2', [newBal, uid]);
    await client.query(
      'INSERT INTO coin_ledger (user_id, delta, reason, meta) VALUES ($1, $2, $3, $4)',
      [uid, -cost, reason || 'purchase', JSON.stringify(meta || {})]
    );
    await client.query('COMMIT');
    res.json({ coin_balance: newBal });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'db_error' });
  } finally {
    client.release();
  }
});

export default router;
