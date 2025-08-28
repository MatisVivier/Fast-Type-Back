// server/routes/friends.js
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import {
  searchUsersByUsername, getPendingRequests, sendFriendRequest,
  acceptRequest, declineRequest, cancelRequest, listFriends,
  removeFriend, getPublicProfile
} from '../services/friends.js';
import { notifyUser } from '../sockets.js'; // on l’ajoute plus bas

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

// --- Search / autocomplete ---
router.get('/friends/search', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ items: [] });

  try {
    const items = await searchUsersByUsername(q, uid, 10);
    res.json({ items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Profil public pour la modale
router.get('/users/:id/profile', async (req, res) => {
  const uid = authUserId(req); // optionnel (on peut afficher public sans être loggé si tu veux)
  const target = req.params.id;
  try {
    const profile = await getPublicProfile(target);
    if (!profile) return res.status(404).json({ error: 'not_found' });
    res.json({ profile });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Envoyer une demande
router.post('/friends/requests', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });
  const { to_user_id } = req.body || {};
  if (!to_user_id || to_user_id === uid) return res.status(400).json({ error: 'invalid_target' });

  try {
    const result = await sendFriendRequest(uid, to_user_id);
    if (result.alreadyFriends) return res.status(409).json({ error: 'already_friends' });
    if (result.alreadyPending) return res.status(409).json({ error: 'already_pending', request_id: result.requestId });

    // Notifier le destinataire (pending ou auto-accept)
    if (result.autoAccepted) {
      notifyUser(to_user_id, 'friend_added', { userId: uid });
      notifyUser(uid, 'friend_added', { userId: to_user_id });
      return res.json({ ok: true, autoAccepted: true, request_id: result.requestId });
    } else {
      notifyUser(to_user_id, 'friend_request', { fromUserId: uid });
      return res.json({ ok: true, request_id: result.requestId, created_at: result.created_at });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Liste des pending (entrantes + sortantes)
router.get('/friends/requests', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });
  try {
    const items = await getPendingRequests(uid);
    res.json({ items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Accepter
router.post('/friends/requests/:id/accept', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });
  try {
    const r = await acceptRequest(req.params.id, uid);
    if (r.notFound) return res.status(404).json({ error: 'not_found' });
    if (r.forbidden) return res.status(403).json({ error: 'forbidden' });
    if (r.alreadyHandled) return res.status(409).json({ error: 'already_handled' });

    notifyUser(uid, 'friend_added', { userId: r.friendId });
    notifyUser(r.friendId, 'friend_added', { userId: uid });
    res.json({ ok: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'server_error' });
  }
});

// Refuser
router.post('/friends/requests/:id/decline', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });
  try {
    const r = await declineRequest(req.params.id, uid);
    if (r.notFoundOrForbidden) return res.status(404).json({ error: 'not_found_or_forbidden' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'server_error' });
  }
});

// Annuler (si c'est toi qui l'as envoyée)
router.post('/friends/requests/:id/cancel', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });
  try {
    const r = await cancelRequest(req.params.id, uid);
    if (!r.ok) return res.status(404).json({ error: 'not_found_or_forbidden' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'server_error' });
  }
});

// Liste des amis
router.get('/friends', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });
  try {
    const items = await listFriends(uid);
    res.json({ items });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'server_error' });
  }
});

// Supprimer un ami
router.delete('/friends/:otherUserId', async (req, res) => {
  const uid = authUserId(req);
  if (!uid) return res.status(401).json({ error: 'not_authenticated' });
  const other = req.params.otherUserId;
  try {
    const r = await removeFriend(uid, other);
    if (!r.ok) return res.status(404).json({ error: 'not_friends' });
    notifyUser(other, 'friend_removed', { userId: uid });
    notifyUser(uid, 'friend_removed', { userId: other });
    res.json({ ok: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'server_error' });
  }
});

export default router;
