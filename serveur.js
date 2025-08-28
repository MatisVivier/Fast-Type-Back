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
import walletRoutes from './routes/wallet.js';
import testRoutes from '.routes/test.js'

// DB pool + keepalive (PostgreSQL)
import pool, { startDbKeepAlive } from './db.js';

const app = express();

// Derrière un proxy (Render) pour que "secure" des cookies soit correct
app.set('trust proxy', 1);

// --- CORS (whitelist) ---
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : [
      'https://matisvivier.github.io', // Front GitHub Pages (origine sans chemin)
      'http://localhost:5173',         // Dev Vite
      // 'https://fast-type-back.onrender.com' // Inutile: c'est le back lui-même
    ];

const corsOptions = {
  origin(origin, cb) {
    // Autorise les requêtes sans header Origin (health checks, curl)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true, // indispensable pour envoyer/recevoir les cookies
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
  // Pas de exposedHeaders requis ici, on n’en lit pas côté client
};

app.use(cors(corsOptions));
// Pré-vols explicites (OPTIONS)
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

app.use('/api', walletRoutes);
app.use('/api', testRoutes);

// Health simple
app.get('/api/healthz', (_req, res) => res.json({ ok: true, via: 'inline' }));

// (debug) endpoint DB (PostgreSQL)
app.get('/api/debug/db', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS users FROM users');
    res.json({ ok: true, users: rows?.[0]?.users ?? 0 });
  } catch (e) {
    console.error('DB debug error:', e.code || e.message);
    res.status(503).json({ ok: false, error: e.code || 'db_error' });
  }
});

// --- Handler d'erreurs CORS propre (évite 500 bruts) ---
app.use((err, _req, res, next) => {
  if (err?.message?.startsWith('Not allowed by CORS')) {
    return res.status(403).json({ ok: false, error: 'cors_blocked', detail: err.message });
  }
  return next(err);
});

// --- HTTP + Sockets ---
const server = http.createServer(app);

// Passe la même whitelist aux sockets (Socket.IO gère ses propres CORS)
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
