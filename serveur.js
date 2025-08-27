// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import http from 'http';

import health from './routes/health.js';
import texts from './routes/texts.js';
import auth from './routes/auth.js';
import soloRoutes from './routes/solo.js';
import accountRoutes from './routes/account.js';
import { attachSockets } from './sockets.js';

// DB pool + keepalive (PostgreSQL)
import pool, { startDbKeepAlive } from './db.js';

const app = express();
app.set('trust proxy', 1);

// --- CORS (whitelist) ---
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : [
      'https://matisvivier.github.io', // GitHub Pages (origin sans chemin)
      'http://localhost:5173',         // dev vite
      'http://localhost:3000'          // dev éventuel
    ];

const corsOptions = {
  origin(origin, cb) {
    // autorise les requêtes sans origin (curl, health checks)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
};

app.use(cors(corsOptions));
// pré-vols explicites (mêmes options)
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// (debug) log des appels REST + origin
app.use((req, _res, next) => {
  if (req.path.startsWith('/api')) {
    console.log('[REST]', req.method, req.path, 'Origin=', req.headers.origin || '∅');
  }
  next();
});

// --- Routes REST ---
app.use('/api', health);
app.use('/api', texts);
app.use('/api', auth);
app.use('/api', soloRoutes);
app.use('/api', accountRoutes);

// Health simple
app.get('/api/healthz', (_req, res) => res.json({ ok: true, via: 'inline' }));

// (debug) endpoint pour vérifier la DB (PostgreSQL)
app.get('/api/debug/db', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS users FROM users');
    res.json({ ok: true, users: rows?.[0]?.users ?? 0 });
  } catch (e) {
    console.error('DB debug error:', e.code || e.message);
    res.status(503).json({ ok: false, error: e.code || 'db_error' });
  }
});

// --- HTTP + Sockets ---
const server = http.createServer(app);

// Passe la même whitelist aux sockets
attachSockets(server, allowedOrigins);

// --- Lancement + vérif DB ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
  console.log(`✅ Server running on :${PORT}`);

  // Keepalive DB pour éviter le sleep des connexions
  startDbKeepAlive();

  // Check DB au boot (PostgreSQL)
  try {
    const { rows } = await pool.query('SELECT 1 AS ok');
    console.log('✅ DB OK', rows[0]);
  } catch (e) {
    console.error('❌ DB KO', e);
  }
});
