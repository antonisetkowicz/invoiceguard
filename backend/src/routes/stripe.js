const express = require('express');
const { stripe } = require('../config/stripe');
const { handlePaymentSuccess } = require('../services/match');

const router = express.Router();

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature verification failed` });
  }

  if (event.type === 'payment_intent.succeeded') {
    await handlePaymentSuccess(event.data.object);
  }

  res.json({ received: true });
});

module.exports = router;
