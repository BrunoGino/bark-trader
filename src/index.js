import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

// Load environment configuration first
import env from './config/environment.js';

import { connectMongoDB } from './database/mongodb.js';
import { connectRedis } from './database/redis.js';
import configRoutes from './routes/config.js';
import enhancedConfigRoutes from './routes/enhancedConfig.js';
import smartLossRoutes from './routes/smartLoss.js';
import tradingRoutes from './routes/trading.js';
import { EnhancedTradingBot } from './trading/EnhancedTradingBot.js';
import { TradingBot } from './trading/TradingBot.js';
import { logger } from './utils/logger.js';
import { WebSocketManager } from './websocket/WebSocketManager.js';

const app = express();
const server = createServer(app);

app.use(helmet());
app.use(cors(env.server.cors));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/trading', tradingRoutes);
app.use('/api/config', configRoutes);
app.use('/api/enhanced-config', enhancedConfigRoutes);
app.use('/api/smart-loss', smartLossRoutes);

app.get('/health', async (req, res) => {
  const features = {
    tradingBot: tradingBot ? 'active' : 'inactive',
    smartLossManager: tradingBot?.smartLossManager ? 'active' : 'inactive',
    enhancedConfig: 'active',
    webSocket: 'active'
  };

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    features,
    version: '2.0.0',
    message: '🐶 Bark Trader with Smart Loss Management!'
  });
});

const wss = new WebSocketServer({
  server,
  path: '/ws',
  perMessageDeflate: false
});

let tradingBot;
let wsManager;

async function startServer() {
  try {
    await connectMongoDB();
    await connectRedis();

    wsManager = new WebSocketManager(wss);

    // Use Enhanced Trading Bot by default
    // Set USE_ORIGINAL_BOT=true in .env to use original bot
    const useOriginalBot = env.trading.useOriginalBot;

    if (useOriginalBot) {
      logger.info('🐶 Starting Original Bark Trader...');
      tradingBot = new TradingBot(wsManager);
    } else {
      logger.info('🐶 Starting Enhanced Bark Trader with Smart Loss...');
      tradingBot = new EnhancedTradingBot(wsManager);
    }

    await tradingBot.initialize();

    server.listen(env.server.port, env.server.host, () => {
      logger.info(`🚀 Bark Trader started on ${env.server.host}:${env.server.port}`);
      logger.info(`🧠 Smart Loss: ${tradingBot.smartLossManager ? 'ACTIVE' : 'INACTIVE'}`);
      logger.info(`📊 WebSocket: ws://${env.server.host}:${env.server.port}/ws`);

      // Log configuration summary
      env.logConfiguration();
    });

    process.on('SIGINT', async () => {
      logger.info('Shutting down Bark Trader...');
      if (tradingBot) await tradingBot.stop();
      server.close(() => process.exit(0));
    });

  } catch (error) {
    logger.error('Failed to start Bark Trader:', error);
    process.exit(1);
  }
}

export { tradingBot, wsManager };

startServer();