import { Router } from 'express';
import pool from '../db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const router = Router();

const COOKIE_NAME = process.env.COOKIE_NAME || 'ta_session';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const isProd = process.env.NODE_ENV === 'production';

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: isProd,          // ✅ secure en prod
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function setAuthCookie(res, payload) {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: undefined });
}

/* -------- Helpers SQL -------- */
async function getUserById(id) {
  const [rows] = await pool.query(
    'SELECT id, email, username, rating, xp, password_hash FROM users WHERE id = ? LIMIT 1',
    [id]
  );
  return rows[0] || null;
}

async function getUserByEmail(email) {
  const [rows] = await pool.query(
    'SELECT id, email, username, rating, xp, password_hash FROM users WHERE email = ? LIMIT 1',
    [email]
  );
  return rows[0] || null;
}

async function getUserByUsername(username) {
  const [rows] = await pool.query(
    'SELECT id, email, username, rating, xp, password_hash FROM users WHERE username = ? LIMIT 1',
    [username]
  );
  return rows[0] || null;
}

/* -------- Register -------- */
/**
 * POST /api/auth/register
 * body: { username, email, password }
 */
router.post('/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};

    if (!username || username.length < 3) {
      return res.status(400).json({ error: 'invalid_username' });
    }
    if (!email || !password) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'weak_password' });
    }

    const [byEmail, byUsername] = await Promise.all([
      getUserByEmail(email),
      getUserByUsername(username),
    ]);
    if (byEmail)    return res.status(409).json({ error: 'email_taken' });
    if (byUsername) return res.status(409).json({ error: 'username_taken' });

    const id = randomUUID();
    const hash = await bcrypt.hash(password, 12);

    await pool.query(
      'INSERT INTO users (id, username, email, password_hash, rating, xp) VALUES (?, ?, ?, ?, 200, 0)',
      [id, username, email, hash]
    );

    const user = await getUserById(id);

    setAuthCookie(res, { sub: id });
    res.json({
      ok: true,
      user: { id: user.id, username: user.username, email: user.email, rating: user.rating, xp: user.xp },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'register_failed' });
  }
});

/* -------- Login -------- */
/**
 * POST /api/auth/login
 * body: { identifier, password }   // identifier = email OU username
 */
router.post('/auth/login', async (req, res) => {
  try {
    const { identifier, password, email, username } = req.body || {};
    const ident = identifier ?? email ?? username;

    if (!ident || !password) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    const user = ident.includes('@')
      ? await getUserByEmail(ident)
      : await getUserByUsername(ident);

    if (!user) return res.status(401).json({ error: 'invalid_credentials' });

    const ok = await bcrypt.compare(password, user.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    setAuthCookie(res, { sub: user.id });
    res.json({
      ok: true,
      user: { id: user.id, username: user.username, email: user.email, rating: user.rating, xp: user.xp },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'login_failed' });
  }
});

/* -------- Me -------- */
/**
 * GET /api/auth/me
 */
router.get('/auth/me', async (req, res) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return res.json({ user: null });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(decoded.sub);

    res.json({
      user: user ? {
        id: user.id, username: user.username, email: user.email, rating: user.rating, xp: user.xp
      } : null
    });
  } catch {
    res.json({ user: null });
  }
});

/* -------- Logout -------- */
router.post('/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

export default router;
