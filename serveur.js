import 'dotenv/config';
import http from 'http';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { Server as IOServer } from 'socket.io';

// routes
import authRouter from './src/routes/auth.js';   // ton fichier existant
// import otherRouters...

const app = express();

// ——— PROD: derrière un proxy (Render) -> cookies/secure ok
app.set('trust proxy', 1);

// ——— CORS : mets l’URL EXACTE de ton front (GitHub Pages)
const ORIGIN = process.env.CORS_ORIGIN || 'https://<username>.github.io/<repo>'; // ← remplace

app.use(cors({
  origin: ORIGIN,
  credentials: true,
}));

app.use(cookieParser());
app.use(express.json());

// ——— API
app.use('/api', authRouter);
// app.use('/api/xxx', xxxRouter);

// ——— Healthcheck (pour Render)
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ——— HTTP server + Socket.IO sur le même port
const server = http.createServer(app);

const io = new IOServer(server, {
  cors: {
    origin: ORIGIN,
    credentials: true,
  },
});

io.on('connection', (socket) => {
  // tes listeners existants
  // socket.on('queue:join', ...)
  // socket.on('match:progress', ...)
});

// ——— Lancement
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log('Server listening on', PORT);
});
