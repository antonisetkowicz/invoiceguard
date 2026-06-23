const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../config/supabase');
const { authenticateUser } = require('../middleware/auth');
const { deliverVoiceNote } = require('../services/delivery');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post('/upload', authenticateUser, upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  const duration = parseInt(req.body.duration, 10);
  if (!duration || duration < 1 || duration > 30) {
    return res.status(400).json({ error: 'Duration must be between 1 and 30 seconds' });
  }

  const fileName = `${req.user.id}/${uuidv4()}.m4a`;

  const { error: uploadError } = await supabase.storage
    .from('voice-notes')
    .upload(fileName, req.file.buffer, {
      contentType: req.file.mimetype || 'audio/mp4',
      upsert: false,
    });

  if (uploadError) {
    return res.status(500).json({ error: 'Failed to upload audio' });
  }

  const { data: voiceNote, error: dbError } = await supabase
    .from('voice_notes')
    .insert({
      sender_id: req.user.id,
      audio_path: fileName,
      duration_seconds: duration,
      status: 'queued',
    })
    .select()
    .single();

  if (dbError) {
    return res.status(500).json({ error: 'Failed to save voice note' });
  }

  const delivery = await deliverVoiceNote(voiceNote.id);

  res.json({
    voiceNote,
    delivered: !!delivery,
  });
});

router.get('/inbox', authenticateUser, async (req, res) => {
  const { data: deliveries, error } = await supabase
    .from('deliveries')
    .select(`
      id,
      delivered_at,
      listened_at,
      responded_at,
      response_emoji,
      response_text,
      voice_notes (
        id,
        audio_path,
        duration_seconds,
        created_at
      )
    `)
    .eq('recipient_id', req.user.id)
    .order('delivered_at', { ascending: false })
    .limit(50);

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch inbox' });
  }

  const enriched = await Promise.all(
    (deliveries || []).map(async (d) => {
      const { data: signedUrl } = await supabase.storage
        .from('voice-notes')
        .createSignedUrl(d.voice_notes.audio_path, 3600);

      return {
        ...d,
        voice_notes: {
          ...d.voice_notes,
          audio_url: signedUrl?.signedUrl || null,
        },
      };
    })
  );

  res.json({ deliveries: enriched });
});

router.get('/sent', authenticateUser, async (req, res) => {
  const { data: voiceNotes, error } = await supabase
    .from('voice_notes')
    .select(`
      id,
      duration_seconds,
      status,
      created_at,
      deliveries (
        id,
        response_emoji,
        response_text,
        responded_at
      )
    `)
    .eq('sender_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch sent notes' });
  }

  res.json({ voiceNotes });
});

router.post('/:deliveryId/respond', authenticateUser, async (req, res) => {
  const { deliveryId } = req.params;
  const { emoji, text } = req.body;

  if (!emoji && !text) {
    return res.status(400).json({ error: 'Must provide emoji or text response' });
  }
  if (text && text.length > 40) {
    return res.status(400).json({ error: 'Text response must be 40 characters or less' });
  }

  const { data: delivery } = await supabase
    .from('deliveries')
    .select('*')
    .eq('id', deliveryId)
    .eq('recipient_id', req.user.id)
    .single();

  if (!delivery) {
    return res.status(404).json({ error: 'Delivery not found' });
  }

  if (delivery.responded_at) {
    return res.status(400).json({ error: 'Already responded' });
  }

  const { data: updated, error } = await supabase
    .from('deliveries')
    .update({
      response_emoji: emoji || null,
      response_text: text || null,
      responded_at: new Date().toISOString(),
    })
    .eq('id', deliveryId)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: 'Failed to save response' });
  }

  res.json({ delivery: updated });
});

router.post('/:deliveryId/listened', authenticateUser, async (req, res) => {
  const { deliveryId } = req.params;

  const { error } = await supabase
    .from('deliveries')
    .update({ listened_at: new Date().toISOString() })
    .eq('id', deliveryId)
    .eq('recipient_id', req.user.id)
    .is('listened_at', null);

  if (error) {
    return res.status(500).json({ error: 'Failed to mark as listened' });
  }

  res.json({ success: true });
});

module.exports = router;
