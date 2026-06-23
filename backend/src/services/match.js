const { supabase } = require('../config/supabase');
const { stripe } = require('../config/stripe');

async function requestReveal(deliveryId, requesterId) {
  const { data: delivery } = await supabase
    .from('deliveries')
    .select('*, voice_notes(sender_id)')
    .eq('id', deliveryId)
    .single();

  if (!delivery) {
    throw new Error('Delivery not found');
  }

  const senderId = delivery.voice_notes.sender_id;
  const recipientId = delivery.recipient_id;

  if (requesterId !== senderId && requesterId !== recipientId) {
    throw new Error('Not authorized for this delivery');
  }

  const { error: insertError } = await supabase
    .from('reveal_requests')
    .insert({ delivery_id: deliveryId, requester_id: requesterId });

  if (insertError && insertError.code === '23505') {
    return { alreadyRequested: true };
  }
  if (insertError) throw insertError;

  const { data: allRequests } = await supabase
    .from('reveal_requests')
    .select('requester_id')
    .eq('delivery_id', deliveryId);

  const requesterIds = (allRequests || []).map(r => r.requester_id);
  const isMutual = requesterIds.includes(senderId) && requesterIds.includes(recipientId);

  if (isMutual) {
    const { data: match } = await supabase
      .from('matches')
      .insert({
        delivery_id: deliveryId,
        user1_id: senderId,
        user2_id: recipientId,
        payment_status: 'pending',
      })
      .select()
      .single();

    return { matched: true, match };
  }

  return { matched: false, requested: true };
}

async function createPaymentIntent(matchId, userId) {
  const { data: match } = await supabase
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .single();

  if (!match) throw new Error('Match not found');
  if (match.user1_id !== userId && match.user2_id !== userId) {
    throw new Error('Not authorized');
  }
  if (match.payment_status === 'paid') {
    throw new Error('Already unlocked');
  }

  const priceCents = parseInt(process.env.REVEAL_PRICE_CENTS || '299', 10);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: priceCents,
    currency: 'usd',
    metadata: {
      match_id: matchId,
      user_id: userId,
    },
  });

  await supabase
    .from('matches')
    .update({ stripe_payment_intent_id: paymentIntent.id })
    .eq('id', matchId);

  return { clientSecret: paymentIntent.client_secret };
}

async function handlePaymentSuccess(paymentIntent) {
  const matchId = paymentIntent.metadata.match_id;
  if (!matchId) return;

  const { data: match } = await supabase
    .from('matches')
    .update({
      payment_status: 'paid',
      unlocked_at: new Date().toISOString(),
    })
    .eq('id', matchId)
    .select()
    .single();

  if (match) {
    await supabase
      .from('users')
      .update({ is_revealed: true })
      .in('id', [match.user1_id, match.user2_id]);
  }

  return match;
}

module.exports = { requestReveal, createPaymentIntent, handlePaymentSuccess };
