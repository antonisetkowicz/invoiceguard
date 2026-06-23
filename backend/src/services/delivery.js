const { supabase } = require('../config/supabase');

async function findRecipient(senderId) {
  const { data: previousRecipients } = await supabase
    .from('delivery_history')
    .select('recipient_id')
    .eq('sender_id', senderId);

  const excludeIds = [
    senderId,
    ...(previousRecipients || []).map(r => r.recipient_id)
  ];

  const { data: candidates, error } = await supabase
    .from('users')
    .select('id')
    .not('id', 'in', `(${excludeIds.join(',')})`)
    .limit(50);

  if (error || !candidates || candidates.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * candidates.length);
  return candidates[randomIndex].id;
}

async function deliverVoiceNote(voiceNoteId) {
  const { data: voiceNote } = await supabase
    .from('voice_notes')
    .select('*')
    .eq('id', voiceNoteId)
    .single();

  if (!voiceNote || voiceNote.status !== 'queued') {
    return null;
  }

  const recipientId = await findRecipient(voiceNote.sender_id);
  if (!recipientId) {
    return null;
  }

  const { data: delivery, error: deliveryError } = await supabase
    .from('deliveries')
    .insert({
      voice_note_id: voiceNoteId,
      recipient_id: recipientId,
    })
    .select()
    .single();

  if (deliveryError) {
    return null;
  }

  await supabase
    .from('voice_notes')
    .update({ status: 'delivered' })
    .eq('id', voiceNoteId);

  await supabase
    .from('delivery_history')
    .upsert({
      sender_id: voiceNote.sender_id,
      recipient_id: recipientId,
    });

  return delivery;
}

async function processQueue() {
  const { data: queuedNotes } = await supabase
    .from('voice_notes')
    .select('id')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(10);

  if (!queuedNotes || queuedNotes.length === 0) return [];

  const results = [];
  for (const note of queuedNotes) {
    const delivery = await deliverVoiceNote(note.id);
    if (delivery) results.push(delivery);
  }
  return results;
}

module.exports = { findRecipient, deliverVoiceNote, processQueue };
