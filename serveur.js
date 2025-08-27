import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import http from 'http';

// === tes routes ===
import health from './routes/health.js';
import texts from './routes/texts.js';
import auth from './routes/auth.js';
import soloRoutes from './routes/solo.js';
import accountRoutes from './routes/account.js';

// === sockets
import { attachSockets } from './sockets.js';

const app = express();

// Render est derrière un proxy → nécessaire pour poser les cookies `secure:true`
app.set('trust proxy', 1);

// CORS : mets l’URL EXACTE de ton front GitHub Pages
// ex: https://matisvivier.github.io/Fast-Type
const ORIGIN = process.env.CORS_ORIGIN || 'https://matis.vivier.github.io/Fast-Type';

app.use(cors({ origin: ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// --- Routes REST (comme avant) ---
app.use('/api', health);
app.use('/api', texts);
app.use('/api', auth);
app.use('/api', soloRoutes);
app.use('/api', accountRoutes);

// (optionnel) petit health inline si tu veux un doublon sûr
app.get('/api/healthz', (_req, res) => res.json({ ok: true, via: 'inline' }));

// --- HTTP server + sockets (comme avant) ---
const server = http.createServer(app);

// branche tes sockets sur le même serveur HTTP
attachSockets(server, ORIGIN);

// --- Lancement ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
