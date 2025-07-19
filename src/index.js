import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { connectMongoDB } from './database/mongodb.js';
import { connectRedis } from './database/redis.js';
import { TradingBot } from './trading/TradingBot.js';
import { WebSocketManager } from './websocket/WebSocketManager.js';
import { logger } from './utils/logger.js';
import tradingRoutes from './routes/trading.js';
import configRoutes from './routes/config.js';

dotenv.config();

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/trading', tradingRoutes);
app.use('/api/config', configRoutes);

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
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
        
    tradingBot = new TradingBot(wsManager);
    await tradingBot.initialize();
        
    server.listen(PORT, () => {
      logger.info(`🚀 Crypto Trading Bot started on port ${PORT}`);
      logger.info(`📊 WebSocket endpoint: ws://localhost:${PORT}/ws`);
      logger.info(`🔧 MongoDB UI: http://localhost:8081`);
      logger.info(`⚡ Redis running on port 6379`);
    });
        
    process.on('SIGINT', async () => {
      logger.info('Shutting down gracefully...');
      if (tradingBot) {
        await tradingBot.stop();
      }
      server.close(() => {
        process.exit(0);
      });
    });
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

export { tradingBot, wsManager };

startServer();