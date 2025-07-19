import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

const configSchema = new mongoose.Schema({
  symbols: [String],
  maxConcurrentSymbols: Number,
  maxLossUSD: Number,
  minGainPercent: Number,
  maxGainPercent: Number,
}, { collection: 'bot_config' });

const Config = mongoose.model('Config', configSchema);

router.get('/', async (req, res) => {
  try {
    const config = await Config.findOne();
    if (!config) return res.status(404).json({ error: 'No config found' });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve config', details: err.message });
  }
});

router.post('/update', async (req, res) => {
  const { symbols, maxConcurrentSymbols, maxLossUSD, minGainPercent, maxGainPercent } = req.body;
  try {
    const config = await Config.findOneAndUpdate(
      {},
      { symbols, maxConcurrentSymbols, maxLossUSD, minGainPercent, maxGainPercent },
      { upsert: true, new: true }
    );
    res.json({ message: 'Config updated successfully', config });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update config', details: err.message });
  }
});

export default router;
