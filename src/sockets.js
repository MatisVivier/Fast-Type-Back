// serveur/src/sockets.js
import { Server } from 'socket.io';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import pool from './db.js';
import { generateMatchText, seededRng } from './textGen.js';
import { gainRanked } from './xp.js';
import { levelFromXp, coinsEarnedBetweenLevels } from '../services/progression.js';

const COOKIE_NAME = process.env.COOKIE_NAME || 'ta_session';
const JWT_SECRET  = process.env.JWT_SECRET  || 'dev_secret';

// Classé = durée fixe 20s
const FIXED_LIMIT = 20;
// Inactivité: 15s consécutives après le départ
const INACT_MS = 15_000;

const queue  = [];          // { socketId, userId, username, rating }
const inMatch = new Map();  // socketId -> matchId
// matchId -> { p1Sid, p2Sid, p1:{...}, p2:{...}, startAt, text, limitSec, p1Stats?, p2Stats?, p1LastAct, p2LastAct, p1Prog?, p2Prog? }
const active = new Map();

/* ------------------------ utils auth & cookies ------------------------ */
function parseCookieHeader(cookieHeader = '') {
  return cookieHeader.split(';').reduce((acc, part) => {
    const [k, ...v] = part.trim().split('=');
    if (!k) return acc;
    acc[k] = decodeURIComponent(v.join('=') || '');
    return acc;
  }, {});
}
function fallbackName({ username, email }) {
  if (username && username.trim()) return username.trim();
  if (email && email.includes('@')) return email.split('@')[0];
  return 'Joueur';
}
async function authFromSocket(socket) {
  try {
    const cookies = parseCookieHeader(socket.handshake.headers.cookie);
    const token = cookies[COOKIE_NAME];
    if (!token) return null;
    const decoded = jwt.verify(token, JWT_SECRET);

    const { rows } = await pool.query(
      `SELECT id, email, username, rating, xp, coin_balance
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [decoded.sub]
    );
    const u = rows[0] || null;
    if (!u) return null;
    return { ...u, username: fallbackName(u) };
  } catch {
    return null;
  }
}

/* ------------------------ génération de texte ------------------------ */
function wordCountForLimit(limitSec) {
  // ~6.5 mots/s (20s -> ~130 mots) — ajustable
  return Math.max(80, Math.round(limitSec * 6.5));
}
async function pickRandomTextForMatch(limitSec = FIXED_LIMIT) {
  const seed  = (Date.now() & 0xffffffff) >>> 0;
  const rng   = seededRng(seed);
  void rng;
  const count = wordCountForLimit(limitSec);
  return generateMatchText(seed, count); // { id, content }
}

/* --------------------------- Elo helpers ----------------------------- */
function expectedScore(rA, rB) { return 1 / (1 + Math.pow(10, (rB - rA) / 400)); }
function newRating(r, score, expected, K = 24) { return Math.round(r + K * (score - expected)); }

/* ----------------------- décision du gagnant ------------------------- */
function isForfeit(s) {
  return typeof s?.finishedBy === 'string' && s.finishedBy.startsWith('forfeit');
}
function decideWinner(p1, p2, limitSec) {
  // pX: { username, wpm, acc (0..1), errors, elapsed (ms) }
  const w1 = p1.wpm || 0;
  const w2 = p2.wpm || 0;
  const a1 = (p1.acc || 0) * 100;  // en %
  const a2 = (p2.acc || 0) * 100;

  const wpmDiff = Math.abs(w1 - w2);
  const accDiff = Math.abs(a1 - a2);

  // 1) WPM prime si > 10
  if (wpmDiff > 10) {
    return { winner: w1 > w2 ? 'p1' : 'p2', reason: 'wpm' };
  }

  // 2) Zone proche (<= 5) : précision si >= 2 pts, sinon WPM
  if (wpmDiff <= 5) {
    if (accDiff >= 2) {
      if (a1 !== a2) return { winner: a1 > a2 ? 'p1' : 'p2', reason: 'accuracy_tiebreak' };
    }
    if (w1 !== w2) return { winner: w1 > w2 ? 'p1' : 'p2', reason: 'wpm_close' };
  }

  // 3) Zone intermédiaire (6..10) : précision seulement si >= 3 pts, sinon WPM
  if (wpmDiff >= 6 && wpmDiff <= 10) {
    if (accDiff >= 3 && a1 !== a2) {
      return { winner: a1 > a2 ? 'p1' : 'p2', reason: 'accuracy_mid' };
    }
    if (w1 !== w2) return { winner: w1 > w2 ? 'p1' : 'p2', reason: 'wpm_mid' };
  }

  // 4) Tie-breakers fins
  if (p1.errors !== p2.errors) {
    return { winner: p1.errors < p2.errors ? 'p1' : 'p2', reason: 'fewer_errors' };
  }
  if (p1.elapsed !== p2.elapsed) {
    return { winner: p1.elapsed < p2.elapsed ? 'p1' : 'p2', reason: 'faster_time' };
  }
  return { winner: null, reason: 'draw' };
}

/* --------------------------- matchmaking ----------------------------- */
async function tryMatch(io) {
  while (queue.length >= 2) {
    const p1 = queue.shift();

    // priorité Elo ±100
    let idx = queue.findIndex(p => Math.abs(p.rating - p1.rating) <= 100);
    if (idx < 0) {
      let best = -1, bestDiff = Infinity;
      for (let i = 0; i < queue.length; i++) {
        const d = Math.abs(queue[i].rating - p1.rating);
        if (d < bestDiff) { bestDiff = d; best = i; }
      }
      idx = best;
    }
    const p2 = idx >= 0 ? queue.splice(idx, 1)[0] : null;
    if (!p2) { queue.unshift(p1); break; }

    const limitSec = FIXED_LIMIT;
    const text     = await pickRandomTextForMatch(limitSec);

    const matchId  = 'match_' + randomUUID();
    const room     = matchId;
    const startAt  = Date.now() + 2000;

    inMatch.set(p1.socketId, matchId);
    inMatch.set(p2.socketId, matchId);
    [p1.socketId, p2.socketId].forEach(sid => io.sockets.sockets.get(sid)?.join(room));

    active.set(matchId, {
      p1Sid: p1.socketId,
      p2Sid: p2.socketId,
      p1: { id: p1.userId, username: p1.username, rating: p1.rating, xp: 0 },
      p2: { id: p2.userId, username: p2.username, rating: p2.rating, xp: 0 },
      startAt,
      text,
      limitSec,
      p1LastAct: startAt,
      p2LastAct: startAt
    });

    io.to(room).emit('matchFound', {
      roomId: room,
      startAt,
      text,
      limitSec,
      players: [
        { id: p1.userId, username: p1.username, rating: p1.rating },
        { id: p2.userId, username: p2.username, rating: p2.rating },
      ]
    });
  }
}

/* ----------------------- fin de match & Elo/XP ----------------------- */
function finalizeAndEmit(io, matchId) {
  const m = active.get(matchId);
  if (!m || !m.p1Stats || !m.p2Stats) return;

  const { p1, p2, p1Stats, p2Stats } = m;
  const decision = decideWinner(p1Stats, p2Stats);
  const p1Exp = expectedScore(p1.rating, p2.rating);
  const p2Exp = expectedScore(p2.rating, p1.rating);

  let p1Score, p2Score;
  if (decision.w === 1) { p1Score = 1; p2Score = 0; }
  else if (decision.w === 2) { p1Score = 0; p2Score = 1; }
  else { p1Score = 0.5; p2Score = 0.5; }

  const p1New = newRating(p1.rating, p1Score, p1Exp);
  const p2New = newRating(p2.rating, p2Score, p2Exp);
  const delta = Math.abs(p1New - p1.rating);
  const totalElapsed = Math.max(p1Stats.elapsed || 0, p2Stats.elapsed || 0);

  const p1Win = decision.w === 1;
  const p2Win = decision.w === 2;
  const p1Xp = gainRanked ? gainRanked(p1Stats, p1Win) : 0;
  const p2Xp = gainRanked ? gainRanked(p2Stats, p2Win) : 0;

    (async () => {
    try {
      await pool.query('BEGIN');

      // p1: calc niveaux & pièces
      const { rows: p1r0 } = await pool.query(
        `SELECT xp, coin_balance FROM users WHERE id = $1 FOR UPDATE`,
        [p1.id]
      );
      const p1OldXp  = p1r0?.[0]?.xp ?? 0;
      const p1OldLvl = levelFromXp(p1OldXp).level;
      const p1NewXp  = p1OldXp + p1Xp;
      const p1NewLvl = levelFromXp(p1NewXp).level;
      const p1Coins  = coinsEarnedBetweenLevels(p1OldLvl, p1NewLvl);

      // p2
      const { rows: p2r0 } = await pool.query(
        `SELECT xp, coin_balance FROM users WHERE id = $1 FOR UPDATE`,
        [p2.id]
      );
      const p2OldXp  = p2r0?.[0]?.xp ?? 0;
      const p2OldLvl = levelFromXp(p2OldXp).level;
      const p2NewXp  = p2OldXp + p2Xp;
      const p2NewLvl = levelFromXp(p2NewXp).level;
      const p2Coins  = coinsEarnedBetweenLevels(p2OldLvl, p2NewLvl);

      // Appliquer updates (rating + xp + coins)
      const { rows: p1r1 } = await pool.query(
        `UPDATE users
            SET rating = $1,
                xp = $2,
                coin_balance = coin_balance + $3
          WHERE id = $4
          RETURNING xp, coin_balance`,
        [p1New, p1NewXp, p1Coins, p1.id]
      );

      const { rows: p2r1 } = await pool.query(
        `UPDATE users
            SET rating = $1,
                xp = $2,
                coin_balance = coin_balance + $3
          WHERE id = $4
          RETURNING xp, coin_balance`,
        [p2New, p2NewXp, p2Coins, p2.id]
      );

      // Historique du match
      await pool.query(
        `INSERT INTO matches (
           p1_id, p2_id, p1_username, p2_username,
           p1_wpm, p2_wpm, p1_acc, p2_acc,
           p1_rating_before, p1_rating_after,
           p2_rating_before, p2_rating_after,
           p1_xp, p2_xp,
           winner_id, reason, elapsed_ms
         )
         VALUES (
           $1, $2, $3, $4,
           $5, $6, $7, $8,
           $9, $10,
           $11, $12,
           $13, $14,
           $15, $16, $17
         )`,
        [
          p1.id, p2.id, p1.username, p2.username,
          p1Stats.wpm, p2Stats.wpm, p1Stats.acc, p2Stats.acc,
          p1.rating, p1New,
          p2.rating, p2New,
          p1Xp, p2Xp,
          (decision.w === 1 ? p1.id : decision.w === 2 ? p2.id : null),
          decision.reason,
          totalElapsed
        ]
      );

      await pool.query('COMMIT');

      // Mettre à jour l'état socket (facultatif, pour cohérence live)
      if (s1?.data?.user) {
        s1.data.user.rating = p1New;
        s1.data.user.xp = p1r1?.[0]?.xp ?? p1NewXp;
        s1.data.user.coin_balance = p1r1?.[0]?.coin_balance ?? (s1.data.user.coin_balance || 0) + p1Coins;
      }
      if (s2?.data?.user) {
        s2.data.user.rating = p2New;
        s2.data.user.xp = p2r1?.[0]?.xp ?? p2NewXp;
        s2.data.user.coin_balance = p2r1?.[0]?.coin_balance ?? (s2.data.user.coin_balance || 0) + p2Coins;
      }

      // Émettre le résultat en incluant les pièces gagnées
      io.to(matchId).emit('match:result', {
        ok: true,
        roomId: matchId,
        reason: decision.reason,
        winnerUserId: decision.w === 1 ? p1.id : (decision.w === 2 ? p2.id : null),
        winnerUsername: decision.w === 1 ? p1.username : (decision.w === 2 ? p2.username : null),
        p1: {
          userId: p1.id,
          username: p1.username,
          wpm: p1Stats.wpm,
          acc: p1Stats.acc,
          elapsed: p1Stats.elapsed,
          ratingBefore: p1.rating,
          ratingAfter: p1New,
          xpGain: p1Xp,
          coinsAwarded: p1Coins
        },
        p2: {
          userId: p2.id,
          username: p2.username,
          wpm: p2Stats.wpm,
          acc: p2Stats.acc,
          elapsed: p2Stats.elapsed,
          ratingBefore: p2.rating,
          ratingAfter: p2New,
          xpGain: p2Xp,
          coinsAwarded: p2Coins
        },
        eloDelta: delta,
        totalElapsed
      });

    } catch (e) {
      console.error('❌ Failed to update ratings/xp/coins', e);
      try { await pool.query('ROLLBACK'); } catch {}
    }
  })();

  const s1 = io.sockets.sockets.get(m.p1Sid);
  const s2 = io.sockets.sockets.get(m.p2Sid);
  if (s1?.data?.user) { s1.data.user.rating = p1New; s1.data.user.xp = (s1.data.user.xp || 0) + p1Xp; }
  if (s2?.data?.user) { s2.data.user.rating = p2New; s2.data.user.xp = (s2.data.user.xp || 0) + p2Xp; }

  const payload = {
    ok: true,
    roomId: matchId,
    reason: decision.reason,
    winnerUserId: decision.w === 1 ? p1.id : (decision.w === 2 ? p2.id : null),
    winnerUsername: decision.w === 1 ? p1.username : (decision.w === 2 ? p2.username : null),
    p1: { userId: p1.id, username: p1.username, wpm: p1Stats.wpm, acc: p1Stats.acc, elapsed: p1Stats.elapsed, ratingBefore: p1.rating, ratingAfter: p1New, xpGain: p1Xp },
    p2: { userId: p2.id, username: p2.username, wpm: p2Stats.wpm, acc: p2Stats.acc, elapsed: p2Stats.elapsed, ratingBefore: p2.rating, ratingAfter: p2New, xpGain: p2Xp },
    eloDelta: delta,
    totalElapsed
  };

  io.to(matchId).emit('match:result', payload);

  s1?.leave(matchId);
  s2?.leave(matchId);
  inMatch.delete(m.p1Sid);
  inMatch.delete(m.p2Sid);
  active.delete(matchId);
}

/* --------- Helpers: stats depuis un progrès (victoire par forfait) -------- */
function statsFromProgress(prog, startAt) {
  if (!prog) {
    const elapsed = Math.max(0, Date.now() - (startAt || Date.now()));
    return { wpm: 0, acc: 1, typed: 0, correct: 0, errors: 0, elapsed, finishedBy: 'win_by_forfeit' };
  }
  const correct = Math.max(0, prog.pos || 0);
  const errors  = Math.max(0, prog.errors || 0);
  const typed   = Math.max(1, correct + errors);
  const elapsed = Math.max(1, prog.t || (Date.now() - (startAt || Date.now())));
  const minutes = elapsed / 60000;
  const wpm     = Math.round((correct / 5) / Math.max(0.001, minutes));
  const acc     = Math.max(0, Math.min(1, correct / typed));
  return { wpm, acc, typed, correct, errors, elapsed, finishedBy: 'win_by_forfeit' };
}

/* ----------------------------- serveur IO ---------------------------- */
/**
 * @param {import('http').Server} httpServer
 * @param {string[]} allowedOrigins - liste blanche des origins autorisés
 */
export function attachSockets(httpServer, allowedOrigins) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    transports: ['polling', 'websocket'],
    // CORS explicite (pas de callback ici → engine.io met les bons headers)
    cors: {
      origin: allowedOrigins,                    // ex: ['https://matisvivier.github.io','http://localhost:5173']
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    },
    // OPTIONS pour /socket.io → forcer les headers CORS attendus par le browser
    handlePreflightRequest: (req, res) => {
      const headers = {
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Origin': req.headers.origin || '*',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Vary': 'Origin',
      };
      res.writeHead(200, headers);
      res.end();
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  /* --------- Surveillance globale de l'inactivité (tick 1s) --------- */
  setInterval(() => {
    const now = Date.now();
    for (const [matchId, m] of active.entries()) {
      if (!m) continue;
      if (now < m.startAt) continue;

      if (!m.p1Stats && now - (m.p1LastAct || m.startAt) >= INACT_MS) {
        m.p1Stats = { wpm: 0, acc: 0, typed: 0, correct: 0, errors: 0, elapsed: now - m.startAt, finishedBy: 'forfeit_inactive' };
        if (!m.p2Stats) m.p2Stats = statsFromProgress(m.p2Prog, m.startAt);
      }
      if (!m.p2Stats && now - (m.p2LastAct || m.startAt) >= INACT_MS) {
        m.p2Stats = { wpm: 0, acc: 0, typed: 0, correct: 0, errors: 0, elapsed: now - m.startAt, finishedBy: 'forfeit_inactive' };
        if (!m.p1Stats) m.p1Stats = statsFromProgress(m.p1Prog, m.startAt);
      }

      if (m.p1Stats && m.p2Stats) {
        finalizeAndEmit(io, matchId);
      }
    }
  }, 1000);

  io.on('connection', async (socket) => {
    console.log('WS connected from origin:', socket.handshake.headers.origin);
    const user = await authFromSocket(socket);
    socket.data.user = user;

    socket.on('queue:join', async () => {
      if (!socket.data.user) {
        socket.emit('queue:error', { error: 'not_authenticated' });
        return;
      }
      if (inMatch.has(socket.id)) return;
      const { id: userId, username, rating = 200 } = socket.data.user;
      queue.push({ socketId: socket.id, userId, username, rating });
      await tryMatch(io);
    });

    socket.on('match:progress', ({ roomId, pos, errors, t }) => {
      const matchId = inMatch.get(socket.id);
      if (!matchId || matchId !== roomId) return;
      const m = active.get(matchId);
      if (!m) return;

      if (socket.id === m.p1Sid) {
        m.p1LastAct = Date.now();
        m.p1Prog = { pos, errors, t };
      } else if (socket.id === m.p2Sid) {
        m.p2LastAct = Date.now();
        m.p2Prog = { pos, errors, t };
      }

      socket.to(roomId).emit('opponent:progress', { pos, errors, t });
    });

    socket.on('match:finish', ({ roomId, stats }) => {
      const matchId = inMatch.get(socket.id);
      if (!matchId || matchId !== roomId) return;
      const m = active.get(matchId);
      if (!m) return;

      if (socket.id === m.p1Sid) m.p1Stats = stats;
      else if (socket.id === m.p2Sid) m.p2Stats = stats;

      if (m.p1Stats && m.p2Stats) finalizeAndEmit(io, matchId);
    });

    socket.on('disconnect', () => {
      const qIdx = queue.findIndex(q => q.socketId === socket.id);
      if (qIdx >= 0) queue.splice(qIdx, 1);

      const matchId = inMatch.get(socket.id);
      if (matchId) {
        const m = active.get(matchId);
        if (m) {
          if (!m.p1Stats && socket.id === m.p1Sid) {
            m.p1Stats = { wpm: 0, acc: 0, typed: 0, correct: 0, errors: 0, elapsed: 0, finishedBy: 'forfeit_disconnect' };
            if (!m.p2Stats) m.p2Stats = statsFromProgress(m.p2Prog, m.startAt);
          }
          if (!m.p2Stats && socket.id === m.p2Sid) {
            m.p2Stats = { wpm: 0, acc: 0, typed: 0, correct: 0, errors: 0, elapsed: 0, finishedBy: 'forfeit_disconnect' };
            if (!m.p1Stats) m.p1Stats = statsFromProgress(m.p1Prog, m.startAt);
          }
          if (m.p1Stats && m.p2Stats) finalizeAndEmit(io, matchId);
        }
      }
      inMatch.delete(socket.id);
    });
  });

  io.engine.on('connection', (raw) => {
    console.log('[ENG] transport=', raw.transport.name);
    raw.on('upgrade', () => {
      console.log('[ENG] upgraded to', raw.transport.name);
    });
  });

  return io;
}
