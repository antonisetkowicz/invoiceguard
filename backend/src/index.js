require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { processQueue } = require('./services/delivery');

const authRoutes = require('./routes/auth');
const voiceRoutes = require('./routes/voice');
const matchRoutes = require('./routes/match');
const stripeRoutes = require('./routes/stripe');

const app = express();
const PORT = process.env.PORT || 3000;

app.use('/api/stripe', stripeRoutes);

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/matches', matchRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const QUEUE_INTERVAL_MS = 30_000;
setInterval(async () => {
  try {
    const delivered = await processQueue();
    if (delivered.length > 0) {
      console.log(`Queue: delivered ${delivered.length} voice notes`);
    }
  } catch (err) {
    console.error('Queue processing error:', err.message);
  }
}, QUEUE_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`VoxDrop backend running on port ${PORT}`);
});
