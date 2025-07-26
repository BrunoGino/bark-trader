import { CronJob } from 'cron';
import Binance from 'node-binance-api';
import { binanceConfig } from '../config/environment.js';
import { redis } from '../database/redis.js';
import { EnhancedTradingConfig } from '../models/EnhancedTradingConfig.js';
import { Order } from '../models/Order.js';
import { logger, logRiskEvent, logTrade } from '../utils/logger.js';
import { calculateTechnicalIndicators } from '../utils/technicalAnalysis.js';
import { SmartLossManager } from './SmartLossManager.js';

export class EnhancedTradingBot {
  constructor(wsManager) {
    this.wsManager = wsManager;
    this.binance = null;
    this.config = null;
    this.isRunning = false;

    // Position tracking
    this.activePositions = new Map(); // symbol -> position details
    this.orderHistory = new Map();    // symbol -> recent orders
    this.riskMetrics = {
      realizedLoss: 0,
      unrealizedLoss: 0,
      totalExposure: 0,
      dailyPnL: 0
    };

    // Performance tracking
    this.performanceMetrics = {
      totalTrades: 0,
      winningTrades: 0,
      totalReturn: 0,
      maxDrawdown: 0,
      consecutiveLosses: 0
    };

    // Market data
    this.priceCache = new Map();
    this.volatilityCache = new Map();
    this.correlationMatrix = new Map();

    // Cron jobs
    this.tradingCronJob = null;
    this.riskCheckCronJob = null;
    this.performanceReviewCronJob = null;
  }

  async initialize() {
    try {
      // Load enhanced configuration
      this.config = await EnhancedTradingConfig.findOne({}) ||
        await EnhancedTradingConfig.createOptimizedConfig(50);

      // Initialize Binance API
      this.binance = new Binance().options({
        APIKEY: binanceConfig.apiKey,
        APISECRET: binanceConfig.secretKey,
        test: binanceConfig.testnet,
        // recvWindow: binanceConfig.recvWindow,
        verbose: binanceConfig.verbose,
        timeout: binanceConfig.timeout
      });

      console.log('key', binanceConfig.apiKey)
      console.log('secret', binanceConfig.secretKey)
      await this.testConnection();
      await this.loadActivePositions();
      await this.calculateInitialRiskMetrics();

      this.setupPriceStreams();
      this.setupCronJobs();

      await this.initializeSmartLossManager();

      logger.info('🐶 Enhanced Bark Trader initialized successfully', {
        totalCapital: this.config.portfolioSettings.totalCapital,
        maxLoss: this.config.maxTotalLossAmount,
        activeSymbols: this.config.activeSymbols.length
      });

    } catch (error) {
      logger.error('Failed to initialize Enhanced Bark Trader:', error);
      throw error;
    }
  }

  async testConnection() {
    try {
      const accountInfo = await this.binance.account();
      logger.info(`🔗 Connected to Binance. Account: ${accountInfo.accountType}`);
      return true;
    } catch (error) {
      logger.error('Binance connection failed:', error.message);
      throw new Error('Failed to connect to Binance API');
    }
  }

  setupCronJobs() {
    // Main trading logic - every 15 minutes
    this.tradingCronJob = new CronJob('*/15 * * * *', async () => {
      if (this.isRunning) {
        await this.executeTradingCycle();
      }
    });

    // Risk monitoring - every 5 minutes
    this.riskCheckCronJob = new CronJob('*/5 * * * *', async () => {
      if (this.isRunning) {
        await this.checkRiskLimits();
      }
    });

    // Performance review - daily at 8 AM
    this.performanceReviewCronJob = new CronJob('0 8 * * *', async () => {
      if (this.isRunning) {
        await this.performDailyReview();
      }
    });

    this.tradingCronJob.start();
    this.riskCheckCronJob.start();
    this.performanceReviewCronJob.start();
  }

  async executeTradingCycle() {
    return await this.executeTradingCycleWithSmartLoss();
  }

  async analyzeSymbolForTrading(symbol, marketCondition) {
    // Get current positions for this symbol
    const positions = this.getPositionsForSymbol(symbol);
    const currentPrice = this.priceCache.get(symbol);

    if (!currentPrice) return;

    // Check if we can place new orders
    const canTrade = await this.canPlaceNewOrder(symbol);
    if (!canTrade) return;

    // Get market data and technical indicators
    const klines = await this.binance.candlesticks(symbol, '15m', false, { limit: 100 });
    const indicators = calculateTechnicalIndicators(klines);

    // Calculate optimal position size
    const volatility = this.volatilityCache.get(symbol) || 0.1;
    const winRate = await this.calculateSymbolWinRate(symbol);
    const positionSize = this.config.calculateOptimalPositionSize(symbol, volatility, winRate);

    // Determine trading strategy based on market conditions and timeframe
    const strategies = this.determineStrategies(indicators, marketCondition, positions.length);

    for (const strategy of strategies) {
      if (strategy.action === 'BUY' && strategy.confidence > 0.6) {
        await this.placeBuyOrder(symbol, positionSize, strategy);
      } else if (strategy.action === 'SELL' && positions.length > 0) {
        await this.evaluateSellConditions(symbol, positions, strategy);
      }
    }
  }

  determineStrategies(indicators, marketCondition, existingPositions) {
    const strategies = [];
    const { rsi, macd, bollinger, currentPrice, sma20, sma50 } = indicators;

    // Day Trading Strategy
    if (this.config.tradingStyle.dayTrading.enabled) {
      const dayTradingSignal = this.evaluateDayTradingSignals(indicators, marketCondition);
      if (dayTradingSignal.confidence > 0.5) {
        strategies.push({
          ...dayTradingSignal,
          type: 'day_trade',
          holdingPeriod: this.config.tradingStyle.dayTrading.maxHoldingPeriodHours * 60 * 60 * 1000,
          profitTarget: this.config.tradingStyle.dayTrading.quickProfitTarget
        });
      }
    }

    // Swing Trading Strategy
    if (this.config.tradingStyle.swingTrading.enabled && existingPositions < 2) {
      const swingTradingSignal = this.evaluateSwingTradingSignals(indicators, marketCondition);
      if (swingTradingSignal.confidence > 0.6) {
        strategies.push({
          ...swingTradingSignal,
          type: 'swing_trade',
          holdingPeriod: this.config.tradingStyle.swingTrading.maxHoldingPeriodDays * 24 * 60 * 60 * 1000,
          profitTarget: this.config.tradingStyle.swingTrading.targetProfitRange.min
        });
      }
    }

    // DCA Strategy for existing losing positions
    if (existingPositions > 0) {
      const dcaSignal = this.evaluateDCAOpportunity(indicators);
      if (dcaSignal.confidence > 0.7) {
        strategies.push({
          ...dcaSignal,
          type: 'dca',
          profitTarget: 5 // Lower profit target for DCA
        });
      }
    }

    return strategies.sort((a, b) => b.confidence - a.confidence);
  }

  evaluateDayTradingSignals(indicators, marketCondition) {
    const { rsi, macd, bollinger, currentPrice } = indicators;
    let score = 0;
    let signals = [];

    // RSI signals
    if (rsi < 35) {
      score += 2;
      signals.push('RSI_OVERSOLD');
    } else if (rsi > 65) {
      score -= 2;
      signals.push('RSI_OVERBOUGHT');
    }

    // Bollinger Bands
    if (currentPrice < bollinger.lower * 1.01) {
      score += 2;
      signals.push('BB_BOUNCE');
    } else if (currentPrice > bollinger.upper * 0.99) {
      score -= 2;
      signals.push('BB_RESISTANCE');
    }

    // MACD momentum
    if (macd.histogram > 0 && macd.macd > macd.signal) {
      score += 1;
      signals.push('MACD_BULLISH');
    }

    // Market condition adjustment
    if (marketCondition === 'bull') {
      score += 1;
    } else if (marketCondition === 'bear') {
      score -= 1;
    }

    return {
      action: score > 0 ? 'BUY' : 'SELL',
      confidence: Math.min(Math.abs(score) / 6, 1),
      signals,
      score
    };
  }

  evaluateSwingTradingSignals(indicators, marketCondition) {
    const { rsi, sma20, sma50, currentPrice, atr } = indicators;
    let score = 0;
    let signals = [];

    // Trend following
    if (currentPrice > sma20 && sma20 > sma50) {
      score += 2;
      signals.push('UPTREND');
    } else if (currentPrice < sma20 && sma20 < sma50) {
      score -= 2;
      signals.push('DOWNTREND');
    }

    // RSI for swing levels
    if (rsi < 40) {
      score += 1;
      signals.push('RSI_SWING_LOW');
    } else if (rsi > 70) {
      score -= 1;
      signals.push('RSI_SWING_HIGH');
    }

    // Volatility consideration
    if (atr && atr > 0) {
      const volatilityScore = Math.min(atr / currentPrice * 100, 3);
      score += volatilityScore > 2 ? 1 : 0; // Higher volatility = more opportunity
    }

    return {
      action: score > 0 ? 'BUY' : 'SELL',
      confidence: Math.min(Math.abs(score) / 5, 1),
      signals,
      score
    };
  }

  evaluateDCAOpportunity(indicators) {
    const { rsi, currentPrice, sma20 } = indicators;
    let score = 0;

    // DCA when price is significantly below average
    if (currentPrice < sma20 * 0.95) score += 2;
    if (rsi < 30) score += 2;

    return {
      action: 'BUY',
      confidence: Math.min(score / 4, 1),
      signals: ['DCA_OPPORTUNITY'],
      score
    };
  }

  async placeBuyOrder(symbol, positionSize, strategy) {
    try {
      const currentPrice = this.priceCache.get(symbol);
      const quantity = (positionSize / currentPrice).toFixed(6);

      // Calculate stop loss and take profit
      const stopLossPrice = currentPrice * (1 - this.config.riskManagement.stopLossPercentage / 100);
      const takeProfitPrice = currentPrice * (1 + strategy.profitTarget / 100);

      const order = await this.binance.marketBuy(symbol, quantity);

      // Save order with strategy information
      const orderDoc = new Order({
        symbol,
        orderId: order.orderId,
        side: 'BUY',
        type: 'MARKET',
        quantity: parseFloat(order.executedQty),
        price: parseFloat(order.fills[0]?.price || currentPrice),
        status: order.status,
        timestamp: new Date(),
        strategy: strategy.type,
        stopLoss: stopLossPrice,
        takeProfit: takeProfitPrice,
        expectedHoldingPeriod: strategy.holdingPeriod,
        confidence: strategy.confidence,
        signals: strategy.signals
      });

      await orderDoc.save();

      // Update active positions
      this.addActivePosition(symbol, {
        orderId: order.orderId,
        entryPrice: parseFloat(order.fills[0]?.price || currentPrice),
        quantity: parseFloat(order.executedQty),
        entryTime: Date.now(),
        strategy: strategy.type,
        stopLoss: stopLossPrice,
        takeProfit: takeProfitPrice,
        signals: strategy.signals
      });

      logTrade('BUY', symbol, {
        quantity: parseFloat(order.executedQty),
        price: parseFloat(order.fills[0]?.price || currentPrice),
        strategy: strategy.type,
        confidence: strategy.confidence,
        positionSize
      });

    } catch (error) {
      logger.error(`Failed to place buy order for ${symbol}:`, error.message);
    }
  }

  async checkExpiredPositions() {
    const currentTime = Date.now();

    for (const [symbol, positions] of this.activePositions.entries()) {
      for (const position of positions) {
        // Check if position should be closed due to time expiry
        if (this.config.shouldAcceptLoss(position, currentTime)) {
          const currentPrice = this.priceCache.get(symbol);
          const unrealizedPnl = (currentPrice - position.entryPrice) * position.quantity;

          logger.warn(`⏰ Position expired for ${symbol}, accepting loss`, {
            holdingPeriod: (currentTime - position.entryTime) / (24 * 60 * 60 * 1000),
            unrealizedPnl,
            strategy: position.strategy
          });

          await this.placeSellOrder(symbol, position, currentPrice, 'ACCEPT_LOSS');
        }
      }
    }
  }

  async evaluateSellConditions(symbol, positions, strategy) {
    const currentPrice = this.priceCache.get(symbol);

    for (const position of positions) {
      const unrealizedPnl = (currentPrice - position.entryPrice) * position.quantity;
      const pnlPercentage = (unrealizedPnl / (position.entryPrice * position.quantity)) * 100;

      let shouldSell = false;
      let sellReason = '';

      // Take profit conditions
      if (currentPrice >= position.takeProfit) {
        shouldSell = true;
        sellReason = 'TAKE_PROFIT';
      }

      // Stop loss conditions
      else if (currentPrice <= position.stopLoss) {
        shouldSell = true;
        sellReason = 'STOP_LOSS';
      }

      // Trailing stop logic
      else if (this.config.riskManagement.enableTrailingStop) {
        const trailingStopPrice = await this.calculateTrailingStop(symbol, position);
        if (currentPrice <= trailingStopPrice) {
          shouldSell = true;
          sellReason = 'TRAILING_STOP';
        }
      }

      // Strategy-specific exit conditions
      else if (strategy.action === 'SELL' && strategy.confidence > 0.7) {
        shouldSell = true;
        sellReason = 'STRATEGY_EXIT';
      }

      // Day trading time limit
      else if (position.strategy === 'day_trade') {
        const holdingTime = currentTime - position.entryTime;
        const maxHoldingTime = this.config.tradingStyle.dayTrading.maxHoldingPeriodHours * 60 * 60 * 1000;

        if (holdingTime >= maxHoldingTime && pnlPercentage > 0) {
          shouldSell = true;
          sellReason = 'DAY_TRADE_TIMEOUT';
        }
      }

      if (shouldSell) {
        await this.placeSellOrder(symbol, position, currentPrice, sellReason);
      }
    }
  }

  async placeSellOrder(symbol, position, currentPrice, reason) {
    try {
      const order = await this.binance.marketSell(symbol, position.quantity);

      // Calculate final P&L
      const totalCost = position.entryPrice * position.quantity;
      const totalRevenue = currentPrice * position.quantity;
      const pnl = totalRevenue - totalCost;
      const pnlPercentage = (pnl / totalCost) * 100;

      // Save sell order
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
        pnlPercentage,
        sellReason: reason,
        holdingPeriodMs: Date.now() - position.entryTime,
        buyOrderId: position.orderId,
        strategy: position.strategy
      });

      await sellOrder.save();

      // Update performance metrics
      this.updatePerformanceMetrics(pnl, reason);

      // Remove from active positions
      this.removeActivePosition(symbol, position.orderId);

      logTrade('SELL', symbol, {
        quantity: position.quantity,
        price: currentPrice,
        pnl,
        pnlPercentage,
        reason,
        strategy: position.strategy,
        holdingPeriod: (Date.now() - position.entryTime) / (60 * 60 * 1000) // hours
      });

    } catch (error) {
      logger.error(`Failed to place sell order for ${symbol}:`, error.message);
    }
  }

  async calculateTrailingStop(symbol, position) {
    // Get highest price since entry
    const redis_key = `trailing_high:${symbol}:${position.orderId}`;
    let highestPrice = await redis.get(redis_key);

    const currentPrice = this.priceCache.get(symbol);

    if (!highestPrice || currentPrice > parseFloat(highestPrice)) {
      highestPrice = currentPrice;
      await redis.setex(redis_key, 86400, currentPrice.toString()); // 24h expiry
    } else {
      highestPrice = parseFloat(highestPrice);
    }

    const trailingStopPrice = highestPrice * (1 - this.config.riskManagement.trailingStopPercentage / 100);
    return Math.max(trailingStopPrice, position.stopLoss); // Don't go below original stop loss
  }

  async canPlaceNewOrder(symbol) {
    // Check current risk exposure
    await this.updateRiskMetrics();

    const totalRisk = this.config.calculateTotalRisk(
      this.riskMetrics.realizedLoss,
      this.riskMetrics.unrealizedLoss
    );

    // Check if within risk limits
    if (totalRisk >= this.config.maxTotalLossAmount) {
      logRiskEvent('MAX_LOSS_REACHED', symbol, totalRisk, this.config.maxTotalLossAmount, 'BLOCK_TRADING');
      return false;
    }

    // Check concurrent orders limit
    const totalActiveOrders = Array.from(this.activePositions.values())
      .reduce((total, positions) => total + positions.length, 0);

    if (totalActiveOrders >= this.config.portfolioSettings.maxConcurrentOrders) {
      return false;
    }

    // Check symbol-specific limits
    const symbolPositions = this.getPositionsForSymbol(symbol);
    if (symbolPositions.length >= this.config.orderManagement.maxOrdersPerSymbol) {
      return false;
    }

    // Check correlation limits
    if (await this.isHighlyCorrelated(symbol)) {
      return false;
    }

    return true;
  }

  async isHighlyCorrelated(symbol) {
    const activeSymbols = Array.from(this.activePositions.keys());
    if (activeSymbols.length === 0) return false;

    for (const activeSymbol of activeSymbols) {
      const correlation = this.correlationMatrix.get(`${symbol}-${activeSymbol}`) || 0;
      if (Math.abs(correlation) > this.config.riskManagement.maxCorrelation) {
        return true;
      }
    }
    return false;
  }

  async updateRiskMetrics() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get today's completed orders for realized loss
    const todaysOrders = await Order.find({
      timestamp: { $gte: today },
      side: 'SELL'
    });

    this.riskMetrics.realizedLoss = this.config.calculateRealizedLoss(todaysOrders);

    // Calculate unrealized loss from active positions
    let unrealizedLoss = 0;
    let totalExposure = 0;

    for (const [symbol, positions] of this.activePositions.entries()) {
      const currentPrice = this.priceCache.get(symbol);
      if (!currentPrice) continue;

      for (const position of positions) {
        const positionValue = position.entryPrice * position.quantity;
        const currentValue = currentPrice * position.quantity;
        const unrealizedPnl = currentValue - positionValue;

        totalExposure += positionValue;
        if (unrealizedPnl < 0) {
          unrealizedLoss += Math.abs(unrealizedPnl);
        }

        // Update position with current unrealized P&L
        position.unrealizedPnl = unrealizedPnl;
        position.currentPrice = currentPrice;
      }
    }

    this.riskMetrics.unrealizedLoss = unrealizedLoss;
    this.riskMetrics.totalExposure = totalExposure;
    this.riskMetrics.dailyPnL = todaysOrders.reduce((sum, order) => sum + (order.pnl || 0), 0);
  }

  async checkRiskLimits() {
    await this.updateRiskMetrics();

    const totalRisk = this.config.calculateTotalRisk(
      this.riskMetrics.realizedLoss,
      this.riskMetrics.unrealizedLoss
    );

    // Emergency stop if total risk exceeds emergency threshold
    if (totalRisk >= this.config.emergencySettings.totalLossEmergencyStop / 100 * this.config.portfolioSettings.totalCapital) {
      logger.error('🚨 EMERGENCY STOP: Total risk limit exceeded');
      await this.emergencyStop('TOTAL_RISK_EXCEEDED');
      return;
    }

    // Check for flash crash
    if (this.config.emergencySettings.flashCrashProtection) {
      const marketChange = await this.detectFlashCrash();
      if (marketChange <= this.config.emergencySettings.flashCrashThreshold) {
        logger.warn('🚨 Flash crash detected, pausing trading');
        await this.pauseTrading(60); // Pause for 1 hour
      }
    }

    // Risk warnings
    const riskPercentage = (totalRisk / this.config.maxTotalLossAmount) * 100;
    if (riskPercentage > 80) {
      logRiskEvent('HIGH_RISK_WARNING', 'PORTFOLIO', totalRisk, this.config.maxTotalLossAmount, 'WARNING');
    }
  }

  async assessMarketConditions() {
    try {
      // Get market data for major cryptocurrencies
      const majorSymbols = ['BTCUSDT', 'ETHUSDT'];
      let totalChange = 0;
      let count = 0;

      for (const symbol of majorSymbols) {
        try {
          const ticker = await this.binance.prevDay(symbol);
          totalChange += parseFloat(ticker.priceChangePercent);
          count++;
        } catch (error) {
          logger.error(`Failed to get market data for ${symbol}:`, error.message);
        }
      }

      if (count === 0) return 'neutral';

      const averageChange = totalChange / count;

      if (averageChange >= this.config.marketConditions.bullMarketThreshold) {
        return 'bull';
      } else if (averageChange <= this.config.marketConditions.bearMarketThreshold) {
        return 'bear';
      } else {
        return 'neutral';
      }
    } catch (error) {
      logger.error('Failed to assess market conditions:', error);
      return 'neutral';
    }
  }

  async detectFlashCrash() {
    const symbols = ['BTCUSDT', 'ETHUSDT'];
    let maxDrop = 0;

    for (const symbol of symbols) {
      try {
        const klines = await this.binance.candlesticks(symbol, '5m', false, { limit: 12 }); // Last hour
        const prices = klines.map(k => parseFloat(k[4])); // Close prices

        const currentPrice = prices[prices.length - 1];
        const hourAgoPrice = prices[0];
        const change = ((currentPrice - hourAgoPrice) / hourAgoPrice) * 100;

        maxDrop = Math.min(maxDrop, change);
      } catch (error) {
        logger.error(`Failed to check flash crash for ${symbol}:`, error.message);
      }
    }

    return maxDrop;
  }

  async isTradingPaused() {
    const pauseKey = 'trading_paused';
    const pausedUntil = await redis.get(pauseKey);

    if (pausedUntil && Date.now() < parseInt(pausedUntil)) {
      return true;
    }

    // Check consecutive losses
    if (this.performanceMetrics.consecutiveLosses >= this.config.emergencySettings.pauseAfterConsecutiveLosses) {
      await this.pauseTrading(this.config.emergencySettings.pauseDurationMinutes);
      return true;
    }

    return false;
  }

  async pauseTrading(minutes) {
    const pauseUntil = Date.now() + (minutes * 60 * 1000);
    await redis.setex('trading_paused', minutes * 60, pauseUntil.toString());

    logger.warn(`🐶 Bark Trader paused for ${minutes} minutes`);

    this.wsManager?.broadcast({
      type: 'TRADING_PAUSED',
      data: { pausedUntil, reason: 'RISK_MANAGEMENT' }
    });
  }

  updatePerformanceMetrics(pnl, reason) {
    this.performanceMetrics.totalTrades++;
    this.performanceMetrics.totalReturn += pnl;

    if (pnl > 0) {
      this.performanceMetrics.winningTrades++;
      this.performanceMetrics.consecutiveLosses = 0;
    } else {
      this.performanceMetrics.consecutiveLosses++;
    }

    // Update max drawdown
    const drawdown = Math.min(0, this.riskMetrics.dailyPnL);
    this.performanceMetrics.maxDrawdown = Math.min(this.performanceMetrics.maxDrawdown, drawdown);
  }

  async calculateSymbolWinRate(symbol) {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const orders = await Order.find({
        symbol,
        side: 'SELL',
        timestamp: { $gte: thirtyDaysAgo }
      });

      if (orders.length === 0) return 0.5; // Default 50% if no history

      const winningOrders = orders.filter(order => order.pnl > 0);
      return winningOrders.length / orders.length;
    } catch (error) {
      logger.error(`Failed to calculate win rate for ${symbol}:`, error.message);
      return 0.5;
    }
  }

  // Position management helpers
  addActivePosition(symbol, position) {
    if (!this.activePositions.has(symbol)) {
      this.activePositions.set(symbol, []);
    }
    this.activePositions.get(symbol).push(position);
  }

  removeActivePosition(symbol, orderId) {
    const positions = this.activePositions.get(symbol);
    if (positions) {
      const filteredPositions = positions.filter(p => p.orderId !== orderId);
      if (filteredPositions.length === 0) {
        this.activePositions.delete(symbol);
      } else {
        this.activePositions.set(symbol, filteredPositions);
      }
    }
  }

  getPositionsForSymbol(symbol) {
    return this.activePositions.get(symbol) || [];
  }

  async loadActivePositions() {
    try {
      // Load from Redis cache first
      const cachedPositions = await redis.hgetall('active_positions');
      for (const [symbol, positionsData] of Object.entries(cachedPositions)) {
        this.activePositions.set(symbol, JSON.parse(positionsData));
      }

      logger.info(`Loaded ${this.activePositions.size} active position groups from cache`);
    } catch (error) {
      logger.error('Failed to load active positions:', error);
    }
  }

  async saveActivePositions() {
    try {
      // Save to Redis
      for (const [symbol, positions] of this.activePositions.entries()) {
        await redis.hset('active_positions', symbol, JSON.stringify(positions));
      }
    } catch (error) {
      logger.error('Failed to save active positions:', error);
    }
  }

  setupPriceStreams() {
    if (!this.config?.activeSymbols?.length) return;

    this.binance.websockets.trades(this.config.activeSymbols, (trade) => {
      this.handlePriceUpdate(trade);
    });
  }

  handlePriceUpdate(trade) {
    const { symbol, price } = trade;
    const numericPrice = parseFloat(price);
    this.priceCache.set(symbol, numericPrice);

    // Calculate volatility
    this.updateVolatility(symbol, numericPrice);

    // Store price in historical data if smart loss manager is available
    if (this.smartLossManager?.historicalDataManager) {
      this.smartLossManager.historicalDataManager.storePriceUpdate(symbol, numericPrice);
    }

    // Broadcast to WebSocket clients
    this.wsManager?.broadcast({
      type: 'PRICE_UPDATE',
      data: { symbol, price: numericPrice }
    });
  }

  updateVolatility(symbol, price) {
    const key = `price_history:${symbol}`;
    const priceHistory = this.getRecentPrices(symbol) || [];
    priceHistory.push(price);

    // Keep only last 100 prices
    if (priceHistory.length > 100) {
      priceHistory.shift();
    }

    // Calculate volatility (standard deviation of returns)
    if (priceHistory.length > 10) {
      const returns = [];
      for (let i = 1; i < priceHistory.length; i++) {
        returns.push((priceHistory[i] - priceHistory[i - 1]) / priceHistory[i - 1]);
      }

      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
      const volatility = Math.sqrt(variance);

      this.volatilityCache.set(symbol, volatility);
    }
  }

  async getRecentPrices(symbol) {
    // Get recent prices from historical data manager
    if (this.smartLossManager?.historicalDataManager) {
      return await this.smartLossManager.historicalDataManager.getRecentPrices(symbol, 50);
    }
    return [];
  }

  async performDailyReview() {
    try {
      logger.info('🐶 Performing daily performance review');

      const review = {
        date: new Date().toISOString().split('T')[0],
        totalReturn: this.performanceMetrics.totalReturn,
        winRate: this.performanceMetrics.totalTrades > 0 ?
          (this.performanceMetrics.winningTrades / this.performanceMetrics.totalTrades) * 100 : 0,
        maxDrawdown: this.performanceMetrics.maxDrawdown,
        currentRisk: this.config.calculateTotalRisk(
          this.riskMetrics.realizedLoss,
          this.riskMetrics.unrealizedLoss
        ),
        activePositions: this.activePositions.size,
        recommendations: []
      };

      // Generate recommendations
      if (review.winRate < 40) {
        review.recommendations.push('Consider adjusting strategy parameters');
      }

      if (review.currentRisk > this.config.maxTotalLossAmount * 0.8) {
        review.recommendations.push('Reduce position sizes or close losing positions');
      }

      logger.info('Daily review completed', review);

      // Broadcast review to WebSocket clients
      this.wsManager?.broadcast({
        type: 'DAILY_REVIEW',
        data: review
      });

      return review;
    } catch (error) {
      logger.error('Daily review failed:', error);
    }
  }

  async calculateInitialRiskMetrics() {
    await this.updateRiskMetrics();
    logger.info('Initial risk metrics calculated', this.riskMetrics);
  }

  broadcastTradingUpdate() {
    const activePositionsArray = Array.from(this.activePositions.entries()).map(([symbol, positions]) => ({
      symbol,
      positions: positions.map(pos => ({
        ...pos,
        currentPrice: this.priceCache.get(symbol),
        unrealizedPnlPercentage: pos.unrealizedPnl ?
          (pos.unrealizedPnl / (pos.entryPrice * pos.quantity)) * 100 : 0
      }))
    }));

    this.wsManager?.broadcast({
      type: 'ENHANCED_TRADING_UPDATE',
      data: {
        activePositions: activePositionsArray,
        riskMetrics: this.riskMetrics,
        performanceMetrics: this.performanceMetrics,
        timestamp: new Date().toISOString()
      }
    });
  }

  async start() {
    this.isRunning = true;
    logger.info('🐶 Enhanced Bark Trader started');
  }

  async stop() {
    this.isRunning = false;
    if (this.tradingCronJob) this.tradingCronJob.stop();
    if (this.riskCheckCronJob) this.riskCheckCronJob.stop();
    if (this.performanceReviewCronJob) this.performanceReviewCronJob.stop();

    await this.saveActivePositions();
    logger.info('🐶 Enhanced Bark Trader stopped');
  }

  async emergencyStop(reason) {
    logger.error(`🚨 EMERGENCY STOP: ${reason}`);

    await this.stop();

    // Close all positions
    const closedPositions = [];
    for (const [symbol, positions] of this.activePositions.entries()) {
      const currentPrice = this.priceCache.get(symbol);
      for (const position of positions) {
        try {
          await this.placeSellOrder(symbol, position, currentPrice, 'EMERGENCY_STOP');
          closedPositions.push(symbol);
        } catch (error) {
          logger.error(`Failed to close emergency position ${symbol}:`, error.message);
        }
      }
    }

    this.wsManager?.broadcast({
      type: 'EMERGENCY_STOP',
      data: { reason, closedPositions, timestamp: new Date().toISOString() }
    });
  }

  async getEnhancedStatus() {
    return {
      isRunning: this.isRunning,
      activePositions: this.activePositions.size,
      riskMetrics: this.riskMetrics,
      performanceMetrics: this.performanceMetrics,
      config: {
        totalCapital: this.config.portfolioSettings.totalCapital,
        maxLoss: this.config.maxTotalLossAmount,
        activeSymbols: this.config.activeSymbols.length
      },
      uptime: process.uptime()
    };
  }

  async initializeSmartLossManager() {
    this.smartLossManager = new SmartLossManager(
      this.config,
      this.binance,
      this.priceCache
    );

    logger.info('🧠 Smart Loss Manager initialized - Bark Trader is now smarter! 🐶');
  }

  async evaluateAllPositions() {
    const evaluationResults = [];

    for (const [symbol, positions] of this.activePositions.entries()) {
      const currentPrice = this.priceCache.get(symbol);
      if (!currentPrice) continue;

      for (const position of positions) {
        try {
          const recommendation = await this.smartLossManager.getPositionRecommendation(symbol, position);

          evaluationResults.push({
            symbol,
            position,
            recommendation,
            currentPrice,
            unrealizedPnl: (currentPrice - position.entryPrice) * position.quantity
          });

          // Execute recommendation if confidence is high enough
          if (recommendation.action === 'SELL') {
            await this.executeSmartSell(symbol, position, recommendation);
          }

        } catch (error) {
          logger.error(`Failed to evaluate position ${symbol}:`, error.message);
        }
      }
    }

    return evaluationResults;
  }

  async executeSmartSell(symbol, position, recommendation) {
    const currentPrice = this.priceCache.get(symbol);
    const { reason, confidence, urgency, details } = recommendation;

    // Different execution strategies based on urgency
    let executionStrategy = 'MARKET'; // Default to market order

    if (urgency === 'HIGH') {
      // Emergency situations - execute immediately at market price
      executionStrategy = 'MARKET';
      logger.warn(`🚨 URGENT SELL: ${symbol} - ${reason}`, { confidence, details });
    } else if (urgency === 'MEDIUM') {
      // Trend reversal - try limit order first, then market if not filled quickly
      executionStrategy = 'SMART_LIMIT';
      logger.info(`📉 TREND SELL: ${symbol} - ${reason}`, { confidence, details });
    } else {
      // Low urgency - can use limit orders to get better prices
      executionStrategy = 'LIMIT';
      logger.info(`⏰ PLANNED SELL: ${symbol} - ${reason}`, { confidence, details });
    }

    try {
      let order;

      switch (executionStrategy) {
        case 'MARKET':
          order = await this.binance.marketSell(symbol, position.quantity);
          break;

        case 'SMART_LIMIT':
          // Try limit order 0.1% below current price
          const limitPrice = currentPrice * 0.999;
          try {
            order = await this.binance.sell(symbol, position.quantity, limitPrice);

            // Set timeout to convert to market order if not filled in 2 minutes
            setTimeout(async () => {
              try {
                const orderStatus = await this.binance.orderStatus(symbol, order.orderId);
                if (orderStatus.status !== 'FILLED') {
                  await this.binance.cancel(symbol, order.orderId);
                  order = await this.binance.marketSell(symbol, position.quantity);
                  logger.info(`Converted limit order to market order for ${symbol}`);
                }
              } catch (error) {
                logger.error(`Failed to check/convert order for ${symbol}:`, error.message);
              }
            }, 120000); // 2 minutes
          } catch (error) {
            // Fallback to market order
            order = await this.binance.marketSell(symbol, position.quantity);
          }
          break;

        case 'LIMIT':
          // Try limit order 0.05% below current price
          const conservativeLimitPrice = currentPrice * 0.9995;
          order = await this.binance.sell(symbol, position.quantity, conservativeLimitPrice);
          break;
      }

      // Calculate P&L
      const totalCost = position.entryPrice * position.quantity;
      const totalRevenue = currentPrice * position.quantity;
      const pnl = totalRevenue - totalCost;
      const pnlPercentage = (pnl / totalCost) * 100;

      // Save sell order with enhanced metadata
      const sellOrder = new Order({
        symbol,
        orderId: order.orderId,
        side: 'SELL',
        type: order.type || 'MARKET',
        quantity: position.quantity,
        price: currentPrice,
        status: order.status,
        timestamp: new Date(),
        pnl,
        pnlPercentage,
        sellReason: reason,
        sellConfidence: confidence,
        sellUrgency: urgency,
        smartSellDetails: details,
        holdingPeriodMs: Date.now() - position.entryTime,
        buyOrderId: position.orderId,
        strategy: position.strategy,
        executionStrategy
      });

      await sellOrder.save();

      // Update performance metrics with enhanced tracking
      this.updatePerformanceMetrics(pnl, reason, confidence);

      // Enhanced logging for smart sells
      if (reason === 'TREND_REVERSAL') {
        logRiskEvent('SMART_TREND_SELL', symbol, pnlPercentage, -5, 'POSITION_CLOSED');
      } else if (reason === 'EMERGENCY_SELL') {
        logRiskEvent('EMERGENCY_SELL', symbol, pnlPercentage, -8, 'EMERGENCY_CLOSE');
      }

      // Remove from active positions
      this.removeActivePosition(symbol, position.orderId);

      // Enhanced trade logging
      logTrade('SMART_SELL', symbol, {
        quantity: position.quantity,
        entryPrice: position.entryPrice,
        exitPrice: currentPrice,
        pnl,
        pnlPercentage,
        reason,
        confidence,
        urgency,
        strategy: position.strategy,
        holdingPeriod: (Date.now() - position.entryTime) / (60 * 60 * 1000), // hours
        smartDetails: details.join(', ')
      });

      // Broadcast enhanced sell notification
      this.wsManager?.broadcast({
        type: 'SMART_SELL_EXECUTED',
        data: {
          symbol,
          reason,
          confidence,
          urgency,
          pnl,
          pnlPercentage,
          details,
          timestamp: new Date().toISOString()
        }
      });

      logger.info(`🐶 Smart sell executed for ${symbol}: ${reason} (${confidence.toFixed(2)} confidence)`, {
        pnl: pnl.toFixed(2),
        percentage: pnlPercentage.toFixed(2),
        details
      });

    } catch (error) {
      logger.error(`Failed to execute smart sell for ${symbol}:`, error.message);

      // Try emergency market sell if limit order fails
      if (urgency === 'HIGH') {
        try {
          const emergencyOrder = await this.binance.marketSell(symbol, position.quantity);
          logger.warn(`Emergency market sell executed for ${symbol} after limit order failure`);
        } catch (emergencyError) {
          logger.error(`Emergency sell also failed for ${symbol}:`, emergencyError.message);
        }
      }
    }
  }

  async executeTradingCycleWithSmartLoss() {
    try {
      logger.info('🐶 Starting Enhanced Bark Trader cycle with Smart Loss Management...');

      // Update risk metrics first
      await this.updateRiskMetrics();

      // Check if trading is paused
      if (await this.isTradingPaused()) {
        logger.info('Trading paused due to risk management');
        return;
      }

      // PRIORITY 1: Evaluate all existing positions with smart loss management
      const positionEvaluations = await this.evaluateAllPositions();

      // PRIORITY 2: Check market conditions for new trades
      const marketCondition = await this.assessMarketConditions();

      // PRIORITY 3: Look for new trading opportunities (only if we have capacity)
      if (this.canAcceptNewPositions()) {
        for (const symbol of this.config.activeSymbols) {
          try {
            await this.analyzeSymbolForTrading(symbol, marketCondition);
          } catch (error) {
            logger.error(`Error analyzing ${symbol} for new trades:`, error.message);
          }
        }
      }

      // PRIORITY 4: Update WebSocket clients with enhanced data
      this.broadcastEnhancedTradingUpdate(positionEvaluations);

      // PRIORITY 5: Generate smart recommendations for manual review
      await this.generateSmartRecommendations(positionEvaluations);

    } catch (error) {
      logger.error('Enhanced trading cycle failed:', error);
    }
  }

  canAcceptNewPositions() {
    const totalActivePositions = Array.from(this.activePositions.values())
      .reduce((total, positions) => total + positions.length, 0);

    // Don't open new positions if:
    // 1. We're at max concurrent orders
    // 2. We have too many consecutive losses
    // 3. We're close to max risk exposure
    // 4. Market conditions are too volatile

    if (totalActivePositions >= this.config.portfolioSettings.maxConcurrentOrders) {
      return false;
    }

    if (this.performanceMetrics.consecutiveLosses >= 3) {
      logger.info('🐶 Bark Trader says: Too many consecutive losses, being cautious with new positions');
      return false;
    }

    const currentRiskPercentage = (this.riskMetrics.realizedLoss / this.config.portfolioSettings.totalCapital) * 100;
    if (currentRiskPercentage > this.config.portfolioSettings.maxLossPercentage * 0.7) {
      logger.info('🐶 Bark Trader says: Approaching risk limit, no new positions');
      return false;
    }

    return true;
  }

  updatePerformanceMetrics(pnl, reason, confidence = 1.0) {
    this.performanceMetrics.totalTrades++;
    this.performanceMetrics.totalReturn += pnl;

    if (pnl > 0) {
      this.performanceMetrics.winningTrades++;
      this.performanceMetrics.consecutiveLosses = 0;
    } else {
      this.performanceMetrics.consecutiveLosses++;

      // Track different types of losses
      if (!this.performanceMetrics.lossTypes) {
        this.performanceMetrics.lossTypes = {};
      }

      this.performanceMetrics.lossTypes[reason] = (this.performanceMetrics.lossTypes[reason] || 0) + 1;
    }

    // Track smart sell effectiveness
    if (reason.includes('TREND') || reason.includes('EMERGENCY')) {
      if (!this.performanceMetrics.smartSells) {
        this.performanceMetrics.smartSells = { total: 0, prevented_larger_losses: 0 };
      }

      this.performanceMetrics.smartSells.total++;

      // If we sold at a small loss due to trend detection, it likely prevented a larger loss
      if (pnl < 0 && pnl > -20 && confidence > 0.7) { // Lost less than $20 with high confidence
        this.performanceMetrics.smartSells.prevented_larger_losses++;
      }
    }

    // Update max drawdown
    const drawdown = Math.min(0, this.riskMetrics.dailyPnL);
    this.performanceMetrics.maxDrawdown = Math.min(this.performanceMetrics.maxDrawdown, drawdown);
  }

  async generateSmartRecommendations(positionEvaluations) {
    const recommendations = [];

    // Analyze position evaluation results
    const highRiskPositions = positionEvaluations.filter(
      e => e.recommendation.confidence > 0.6 && e.recommendation.action === 'SELL'
    );

    const strongHoldPositions = positionEvaluations.filter(
      e => e.recommendation.confidence > 0.7 && e.recommendation.action === 'HOLD'
    );

    // Generate recommendations
    if (highRiskPositions.length > 0) {
      recommendations.push({
        type: 'WARNING',
        priority: 'HIGH',
        title: `🚨 ${highRiskPositions.length} Position(s) at Risk`,
        message: `Bark Trader detected potential trend reversals in: ${highRiskPositions.map(p => p.symbol).join(', ')}`,
        action: 'Consider manual review of these positions',
        positions: highRiskPositions.map(p => ({
          symbol: p.symbol,
          reason: p.recommendation.reason,
          confidence: p.recommendation.confidence,
          unrealizedPnl: p.unrealizedPnl
        }))
      });
    }

    if (strongHoldPositions.length > 0) {
      const profitableHolds = strongHoldPositions.filter(p => p.unrealizedPnl > 0);
      if (profitableHolds.length > 0) {
        recommendations.push({
          type: 'POSITIVE',
          priority: 'LOW',
          title: `📈 ${profitableHolds.length} Strong Position(s)`,
          message: `Trending well: ${profitableHolds.map(p => p.symbol).join(', ')}`,
          action: 'Continue holding, trends look positive',
          totalUnrealizedProfit: profitableHolds.reduce((sum, p) => sum + p.unrealizedPnl, 0)
        });
      }
    }

    // Market condition recommendations
    const marketCondition = await this.assessMarketConditions();
    if (marketCondition === 'bear') {
      recommendations.push({
        type: 'CAUTION',
        priority: 'MEDIUM',
        title: '🐻 Bear Market Detected',
        message: 'Market showing bearish signals, Bark Trader will be more conservative',
        action: 'Consider reducing position sizes and tightening stop losses'
      });
    } else if (marketCondition === 'bull') {
      recommendations.push({
        type: 'OPPORTUNITY',
        priority: 'LOW',
        title: '🚀 Bull Market Detected',
        message: 'Market showing bullish signals, good time for new positions',
        action: 'Bark Trader may increase position sizes in favorable conditions'
      });
    }

    // Risk utilization recommendations
    const riskUtilization = (this.riskMetrics.realizedLoss / this.config.maxTotalLossAmount) * 100;
    if (riskUtilization > 60) {
      recommendations.push({
        type: 'WARNING',
        priority: 'HIGH',
        title: '⚠️ High Risk Utilization',
        message: `Using ${riskUtilization.toFixed(1)}% of maximum allowed loss`,
        action: 'Consider closing some positions or reducing new position sizes'
      });
    }

    // Store recommendations for API access
    this.currentRecommendations = recommendations;

    // Broadcast to WebSocket clients
    this.wsManager?.broadcast({
      type: 'SMART_RECOMMENDATIONS',
      data: {
        recommendations,
        timestamp: new Date().toISOString(),
        portfolioHealth: this.calculatePortfolioHealth()
      }
    });

    return recommendations;
  }

  // Calculate overall portfolio health score
  calculatePortfolioHealth() {
    let healthScore = 100;

    // Deduct points for risk utilization
    const riskUtilization = (this.riskMetrics.realizedLoss / this.config.maxTotalLossAmount) * 100;
    healthScore -= riskUtilization * 0.5; // Max 50 points deduction

    // Deduct points for consecutive losses
    healthScore -= this.performanceMetrics.consecutiveLosses * 10; // 10 points per consecutive loss

    // Deduct points for high unrealized losses
    const unrealizedLossRatio = this.riskMetrics.unrealizedLoss / this.config.portfolioSettings.totalCapital;
    healthScore -= unrealizedLossRatio * 100; // Percentage-based deduction

    // Add points for profitable positions
    let totalUnrealizedProfit = 0;
    for (const positions of this.activePositions.values()) {
      for (const position of positions) {
        if (position.unrealizedPnl > 0) {
          totalUnrealizedProfit += position.unrealizedPnl;
        }
      }
    }

    const profitBonus = Math.min((totalUnrealizedProfit / this.config.portfolioSettings.totalCapital) * 100, 20);
    healthScore += profitBonus;

    // Add points for good win rate
    const winRate = this.performanceMetrics.totalTrades > 0 ?
      (this.performanceMetrics.winningTrades / this.performanceMetrics.totalTrades) * 100 : 50;

    if (winRate > 60) {
      healthScore += (winRate - 60) * 0.5; // Bonus for high win rate
    }

    return {
      score: Math.max(0, Math.min(100, healthScore)),
      riskUtilization,
      winRate,
      consecutiveLosses: this.performanceMetrics.consecutiveLosses,
      totalUnrealizedProfit,
      activePositions: Array.from(this.activePositions.values()).reduce((total, positions) => total + positions.length, 0)
    };
  }

  // Enhanced WebSocket broadcasting with smart analysis
  broadcastEnhancedTradingUpdate(positionEvaluations) {
    const enhancedData = {
      activePositions: Array.from(this.activePositions.entries()).map(([symbol, positions]) => ({
        symbol,
        positions: positions.map(pos => {
          const evaluation = positionEvaluations.find(e =>
            e.symbol === symbol && e.position.orderId === pos.orderId
          );

          return {
            ...pos,
            currentPrice: this.priceCache.get(symbol),
            unrealizedPnlPercentage: pos.unrealizedPnl ?
              (pos.unrealizedPnl / (pos.entryPrice * pos.quantity)) * 100 : 0,
            smartRecommendation: evaluation?.recommendation || null,
            trendAnalysis: evaluation?.trendAnalysis || null
          };
        })
      })),
      riskMetrics: {
        ...this.riskMetrics,
        riskUtilizationPercentage: (this.riskMetrics.realizedLoss / this.config.maxTotalLossAmount) * 100
      },
      performanceMetrics: this.performanceMetrics,
      portfolioHealth: this.calculatePortfolioHealth(),
      smartRecommendations: this.currentRecommendations || [],
      marketCondition: this.lastMarketCondition || 'neutral',
      timestamp: new Date().toISOString()
    };

    this.wsManager?.broadcast({
      type: 'ENHANCED_BARK_TRADER_UPDATE',
      data: enhancedData
    });
  }

  // API endpoint to get current smart recommendations
  async getSmartRecommendations() {
    if (!this.currentRecommendations) {
      await this.generateSmartRecommendations([]);
    }

    return {
      recommendations: this.currentRecommendations,
      portfolioHealth: this.calculatePortfolioHealth(),
      lastUpdate: new Date().toISOString(),
      smartSellStats: {
        total: this.performanceMetrics.smartSells?.total || 0,
        preventedLosses: this.performanceMetrics.smartSells?.prevented_larger_losses || 0,
        effectiveness: this.performanceMetrics.smartSells?.total > 0 ?
          (this.performanceMetrics.smartSells.prevented_larger_losses / this.performanceMetrics.smartSells.total * 100) : 0
      }
    };
  }

}