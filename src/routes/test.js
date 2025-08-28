// routes/test.js
console.log('[test] routes file loaded');

import { Router } from 'express';

const router = Router();

// Ping simple (sans auth)
router.get('/test/ping', (_req, res) => {
  res.json({ ok: true, msg: 'pong', at: new Date().toISOString() });
});

// Qui tourne ? (montre le fichier réellement chargé)
router.get('/test/which', (_req, res) => {
  res.json({
    router_file: import.meta.url,
    cwd: process.cwd(),
  });
});

// Echo headers/query/body
router.get('/test/echo', (req, res) => {
  res.json({
    method: req.method,
    path: req.path,
    query: req.query,
    headers: req.headers,
  });
});

export default router;
