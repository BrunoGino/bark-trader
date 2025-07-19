import Binance from 'node-binance-api';
import { CronJob } from 'cron';
import { Order } from '../models/Order.js';
import { TradingConfig } from '../models/TradingConfig.js';
import { redis } from '../database/redis.js';
import { logger } from '../utils/logger.js';
import { calculateTechnicalIndicators } from '../utils/technicalAnalysis.js';

export class TradingBot {
  constructor(wsManager) {
    this.wsManager = wsManager;
    this.binance = null;
    this.activeOrders = new Map();
    this.dailyStats = new Map();
    this.isRunning = false;
    this.config = null;
    this.cronJob = null;
    this.priceCache = new Map();
    this.orderBook = new Map();
  }

  async initialize() {
    try {      
      this.config = await TradingConfig.findOne({}) || await this.createDefaultConfig();
            
      this.binance = new Binance().options({
        APIKEY: process.env.BINANCE_API_KEY,
        APISECRET: process.env.BINANCE_SECRET_KEY,
        test: process.env.BINANCE_TESTNET === 'true'
      });
    
      await this.testConnection();
      
      await this.loadActiveOrders();
      
      this.setupPriceStreams();
            
      this.setupTradingSchedule();
      
      logger.info('Trading bot initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize trading bot:', error);
      throw error;
    }
  }

  async createDefaultConfig() {
    const defaultConfig = new TradingConfig({
      activeSymbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'DOGEUSDT'],
      maxConcurrentTrades: 5,
      maxLossPerTrade: 50, // $50 USD
      tradingWindowMinutes: 15,
      maxDailyGainPercent: 3,
      minGainPercent: 1,
      maxTotalLoss: 50,
      isActive: true
    });
    
    await defaultConfig.save();
    return defaultConfig;
  }

  async testConnection() {
    try {
      const accountInfo = await this.binance.account();
      logger.info(`Connected to Binance. Account status: ${accountInfo.accountType}`);
      return true;
    } catch (error) {
      logger.error('Binance connection failed:', error.message);
      throw new Error('Failed to connect to Binance API');
    }
  }

  setupPriceStreams() {
    if (!this.config?.activeSymbols?.length) return;
        
    this.binance.websockets.trades(this.config.activeSymbols, (trade) => {
      this.handlePriceUpdate(trade);
    });

    this.binance.websockets.depthCache(this.config.activeSymbols, (symbol, depth) => {
      this.orderBook.set(symbol, depth);
    });
  }

  setupTradingSchedule() {
    const cronPattern = `*/${this.config.tradingWindowMinutes} * * * *`;
    
    this.cronJob = new CronJob(cronPattern, async () => {
      if (this.isRunning) {
        await this.executeTradingCycle();
      }
    });
    
    this.cronJob.start();
    logger.info(`Trading schedule started: every ${this.config.tradingWindowMinutes} minutes`);
  }

  async executeTradingCycle() {
    try {
      logger.info('Starting trading cycle...');
      
      this.config = await TradingConfig.findOne({});
      
      if (!this.config?.isActive) {
        logger.info('Trading is disabled in config');
        return;
      }

      if (!await this.checkDailyLimits()) {
        logger.warn('Daily limits reached, skipping trading cycle');
        return;
      }

      for (const symbol of this.config.activeSymbols) {
        try {
          await this.analyzeAndTrade(symbol);
        } catch (error) {
          logger.error(`Error trading ${symbol}:`, error.message);
        }
      }
      
      this.broadcastTradingUpdate();
      
    } catch (error) {
      logger.error('Trading cycle failed:', error);
    }
  }

  async analyzeAndTrade(symbol) {
    if (this.activeOrders.has(symbol)) {
      await this.checkExistingPosition(symbol);
      return;
    }

    if (this.activeOrders.size >= this.config.maxConcurrentTrades) {
      logger.info(`Max concurrent trades (${this.config.maxConcurrentTrades}) reached`);
      return;
    }

    const klines = await this.binance.candlesticks(symbol, '15m', false, { limit: 100 });
    const indicators = calculateTechnicalIndicators(klines);
    
    const shouldBuy = await this.shouldBuy(symbol, indicators);
    
    if (shouldBuy) {
      await this.placeBuyOrder(symbol);
    }
  }

  async shouldBuy(symbol, indicators) {
    // Simple RSI + Moving Average strategy
    const { rsi, sma20, sma50, currentPrice } = indicators;
    
    // Buy conditions:
    // 1. RSI is oversold (< 30)
    // 2. Price is above SMA20
    // 3. SMA20 > SMA50 (uptrend)
    return rsi < 30 && currentPrice > sma20 && sma20 > sma50;
  }

  async placeBuyOrder(symbol) {
    try {
      const currentPrice = this.priceCache.get(symbol);
      if (!currentPrice) return;
      
      const quantity = this.calculatePositionSize(symbol, currentPrice);
      
      const order = await this.binance.marketBuy(symbol, quantity);
            
      const orderDoc = new Order({
        symbol,
        orderId: order.orderId,
        side: 'BUY',
        type: 'MARKET',
        quantity: parseFloat(order.executedQty),
        price: parseFloat(order.fills[0]?.price || currentPrice),
        status: order.status,
        timestamp: new Date(),
        originalQuantity: parseFloat(order.origQty)
      });
      
      await orderDoc.save();
      
      this.activeOrders.set(symbol, {
        orderId: order.orderId,
        buyPrice: parseFloat(order.fills[0]?.price || currentPrice),
        quantity: parseFloat(order.executedQty),
        timestamp: Date.now()
      });
      
      await redis.hset('active_orders', symbol, JSON.stringify(this.activeOrders.get(symbol)));
      
      logger.info(`Buy order placed for ${symbol}: ${quantity} at $${currentPrice}`);
      
    } catch (error) {
      logger.error(`Failed to place buy order for ${symbol}:`, error.message);
    }
  }

  async checkExistingPosition(symbol) {
    const position = this.activeOrders.get(symbol);
    if (!position) return;

    const currentPrice = this.priceCache.get(symbol);
    if (!currentPrice) return;

    const priceChange = ((currentPrice - position.buyPrice) / position.buyPrice) * 100;
    
    const shouldSell = priceChange >= this.config.minGainPercent || 
                      priceChange <= -this.calculateMaxLossPercent(position.buyPrice);
    
    if (shouldSell) {
      await this.placeSellOrder(symbol, position, currentPrice);
    }
  }

  async placeSellOrder(symbol, position, currentPrice) {
    try {
      const order = await this.binance.marketSell(symbol, position.quantity);
      
      const totalCost = position.buyPrice * position.quantity;
      const totalRevenue = currentPrice * position.quantity;
      const pnl = totalRevenue - totalCost;
      
      const sellOrder = new Order({
        symbol,
        orderId: order.orderId,
        side: 'SELL',
        type: 'MARKET',
        quantity: position.quantity,
        price: currentPrice,
        status: order.status,
        timestamp: new Date(),
        pnl,
        buyOrderId: position.orderId
      });
      
      await sellOrder.save();
      
      this.activeOrders.delete(symbol);
      await redis.hdel('active_orders', symbol);
      
      this.updateDailyStats(symbol, pnl);
      
      logger.info(`Sell order placed for ${symbol}: P&L: $${pnl.toFixed(2)}`);
      
    } catch (error) {
      logger.error(`Failed to place sell order for ${symbol}:`, error.message);
    }
  }

  calculatePositionSize(symbol, price) {
    const riskAmount = Math.min(this.config.maxLossPerTrade, 10); // Max $10 risk per trade
    const quantity = (riskAmount / price).toFixed(6);
    return quantity;
  }

  calculateMaxLossPercent(buyPrice) {
    return (this.config.maxLossPerTrade / buyPrice) * 100;
  }

  async checkDailyLimits() {
    const today = new Date().toDateString();
    const dailyOrders = await Order.find({
      timestamp: {
        $gte: new Date(today),
        $lt: new Date(new Date(today).getTime() + 24 * 60 * 60 * 1000)
      }
    });

    const totalLoss = dailyOrders
      .filter(order => order.pnl < 0)
      .reduce((sum, order) => sum + Math.abs(order.pnl), 0);

    return totalLoss < this.config.maxTotalLoss;
  }

  updateDailyStats(symbol, pnl) {
    const today = new Date().toDateString();
    const key = `${symbol}-${today}`;
    
    if (!this.dailyStats.has(key)) {
      this.dailyStats.set(key, { trades: 0, pnl: 0 });
    }
    
    const stats = this.dailyStats.get(key);
    stats.trades += 1;
    stats.pnl += pnl;
    
    this.dailyStats.set(key, stats);
  }

  handlePriceUpdate(trade) {
    const { symbol, price } = trade;
    this.priceCache.set(symbol, parseFloat(price));
    
    this.wsManager?.broadcast({
      type: 'PRICE_UPDATE',
      data: { symbol, price: parseFloat(price) }
    });
  }

  async loadActiveOrders() {
    try {
      const orders = await redis.hgetall('active_orders');
      for (const [symbol, orderData] of Object.entries(orders)) {
        this.activeOrders.set(symbol, JSON.parse(orderData));
      }
      logger.info(`Loaded ${this.activeOrders.size} active orders from Redis`);
    } catch (error) {
      logger.error('Failed to load active orders:', error);
    }
  }

  broadcastTradingUpdate() {
    const activeOrdersArray = Array.from(this.activeOrders.entries()).map(([symbol, order]) => ({
      symbol,
      ...order,
      currentPrice: this.priceCache.get(symbol),
      unrealizedPnl: this.calculateUnrealizedPnl(symbol, order)
    }));

    this.wsManager?.broadcast({
      type: 'TRADING_UPDATE',
      data: {
        activeOrders: activeOrdersArray,
        totalActivePositions: this.activeOrders.size,
        timestamp: new Date().toISOString()
      }
    });
  }

  calculateUnrealizedPnl(symbol, order) {
    const currentPrice = this.priceCache.get(symbol);
    if (!currentPrice || !order) return 0;
    
    return (currentPrice - order.buyPrice) * order.quantity;
  }

  async start() {
    this.isRunning = true;
    logger.info('Trading bot started');
  }

  async stop() {
    this.isRunning = false;
    if (this.cronJob) {
      this.cronJob.stop();
    }
    logger.info('Trading bot stopped');
  }

  async getStatus() {
    return {
      isRunning: this.isRunning,
      activePositions: this.activeOrders.size,
      config: this.config,
      uptime: process.uptime()
    };
  }
}