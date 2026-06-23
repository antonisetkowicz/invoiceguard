const express = require('express');
const { supabase } = require('../config/supabase');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();

router.post('/anonymous', async (req, res) => {
  const { data, error } = await supabase.auth.signInAnonymously();

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  const { data: user } = await supabase
    .from('users')
    .insert({ supabase_auth_id: data.user.id })
    .select()
    .single();

  res.json({
    session: data.session,
    user,
  });
});

router.get('/me', authenticateUser, async (req, res) => {
  res.json({ user: req.user });
});

router.patch('/profile', authenticateUser, async (req, res) => {
  const { username, avatar_url } = req.body;

  const updates = {};
  if (username !== undefined) updates.username = username;
  if (avatar_url !== undefined) updates.avatar_url = avatar_url;

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', req.user.id)
    .select()
    .single();

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ user: data });
});

module.exports = router;
