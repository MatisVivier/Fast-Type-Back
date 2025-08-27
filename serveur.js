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

const app = express();
app.set('trust proxy', 1);

// --- CORS ---
const allowedOrigins = (process.env.CORS_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean)) || [
  'https://matisvivier.github.io',   // ← GitHub Pages (origin sans chemin)
  'http://localhost:5173',           // ← dev vite
  'http://localhost:3000'            // ← dev éventuel
];

app.use(cors({
  origin(origin, cb) {
    // autorise les requêtes sans origin (curl, health checks)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// pré-vols explicites (utile derrière proxy/CDN)
app.options('*', cors());

app.use(express.json());
app.use(cookieParser());

// --- Routes REST ---
app.use('/api', health);
app.use('/api', texts);
app.use('/api', auth);
app.use('/api', soloRoutes);
app.use('/api', accountRoutes);

// health doublon
app.get('/api/healthz', (_req, res) => res.json({ ok: true, via: 'inline' }));

// --- HTTP + Sockets ---
const server = http.createServer(app);

// Passe la même whitelist aux sockets
attachSockets(server, allowedOrigins);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ Server running on :${PORT}`);
});
