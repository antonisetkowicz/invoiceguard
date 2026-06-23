const express = require('express');
const { authenticateUser } = require('../middleware/auth');
const { requestReveal, createPaymentIntent } = require('../services/match');
const { supabase } = require('../config/supabase');

const router = express.Router();

router.post('/:deliveryId/reveal', authenticateUser, async (req, res) => {
  try {
    const result = await requestReveal(req.params.deliveryId, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:matchId/pay', authenticateUser, async (req, res) => {
  try {
    const result = await createPaymentIntent(req.params.matchId, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/', authenticateUser, async (req, res) => {
  const { data: matches, error } = await supabase
    .from('matches')
    .select(`
      id,
      payment_status,
      unlocked_at,
      created_at,
      delivery:deliveries (
        id,
        voice_notes (
          id,
          duration_seconds
        )
      ),
      user1:users!matches_user1_id_fkey (
        id, username, avatar_url
      ),
      user2:users!matches_user2_id_fkey (
        id, username, avatar_url
      )
    `)
    .or(`user1_id.eq.${req.user.id},user2_id.eq.${req.user.id}`)
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch matches' });
  }

  const sanitized = (matches || []).map(m => {
    if (m.payment_status !== 'paid') {
      if (m.user1) { m.user1.username = null; m.user1.avatar_url = null; }
      if (m.user2) { m.user2.username = null; m.user2.avatar_url = null; }
    }
    return m;
  });

  res.json({ matches: sanitized });
});

module.exports = router;
