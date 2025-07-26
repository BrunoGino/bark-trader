// Enhanced Smart Loss Management System for Bark Trader 🐶
import { logger } from '../utils/logger.js';
import { calculateTechnicalIndicators, identifyTrend } from '../utils/technicalAnalysis.js';
import { HistoricalDataManager } from './HistoricalDataManager.js';

export class SmartLossManager {
  constructor(config, binance, priceCache) {
    this.config = config;
    this.binance = binance;
    this.priceCache = priceCache;
    this.trendCache = new Map(); // symbol -> trend analysis
    this.priceHistory = new Map(); // symbol -> price history
    this.volatilityCache = new Map(); // symbol -> volatility metrics
    this.historicalDataManager = new HistoricalDataManager();
  }

  // Main decision engine: Should we sell this position?
  async shouldSellPosition(symbol, position, currentPrice) {
    const analysis = await this.analyzePosition(symbol, position, currentPrice);

    // Decision priority (most important first):
    // 1. Emergency sell conditions (flash crash, extreme downtrend)
    // 2. Clear downward trend with momentum
    // 3. Stop loss hit
    // 4. Time-based accept loss
    // 5. Take profit conditions

    if (analysis.emergencySell.shouldSell) {
      return {
        shouldSell: true,
        reason: 'EMERGENCY_SELL',
        confidence: analysis.emergencySell.confidence,
        urgency: 'HIGH',
        details: analysis.emergencySell.details
      };
    }

    if (analysis.trendSell.shouldSell) {
      return {
        shouldSell: true,
        reason: 'TREND_REVERSAL',
        confidence: analysis.trendSell.confidence,
        urgency: 'MEDIUM',
        details: analysis.trendSell.details
      };
    }

    if (analysis.stopLoss.shouldSell) {
      return {
        shouldSell: true,
        reason: 'STOP_LOSS',
        confidence: 1.0,
        urgency: 'HIGH',
        details: analysis.stopLoss.details
      };
    }

    if (analysis.timeBasedSell.shouldSell) {
      return {
        shouldSell: true,
        reason: 'TIME_BASED_LOSS',
        confidence: analysis.timeBasedSell.confidence,
        urgency: 'LOW',
        details: analysis.timeBasedSell.details
      };
    }

    if (analysis.takeProfit.shouldSell) {
      return {
        shouldSell: true,
        reason: 'TAKE_PROFIT',
        confidence: 1.0,
        urgency: 'LOW',
        details: analysis.takeProfit.details
      };
    }

    return {
      shouldSell: false,
      reason: 'HOLD',
      confidence: analysis.holdConfidence,
      urgency: 'NONE',
      details: analysis.holdReasons
    };
  }

  async analyzePosition(symbol, position, currentPrice) {
    // Get comprehensive market data
    const klines = await this.binance.candlesticks(symbol, '15m', false, { limit: 100 });
    const indicators = calculateTechnicalIndicators(klines);
    const trend = await this.analyzeTrend(symbol, klines);
    const momentum = await this.analyzeMomentum(symbol, indicators);
    const volatility = await this.analyzeVolatility(symbol, klines);

    // Store historical data for future analysis
    await this.historicalDataManager.storeIndicatorsBatch(symbol, {
      rsi: indicators.rsi,
      volatility: volatility.current,
      currentPrice
    });

    const unrealizedPnl = (currentPrice - position.entryPrice) * position.quantity;
    const pnlPercentage = (unrealizedPnl / (position.entryPrice * position.quantity)) * 100;
    const holdingTime = Date.now() - position.entryTime;

    return {
      emergencySell: await this.checkEmergencyConditions(symbol, indicators, trend, pnlPercentage),
      trendSell: await this.checkTrendReversal(symbol, trend, momentum, indicators, pnlPercentage),
      stopLoss: this.checkStopLoss(position, currentPrice, pnlPercentage),
      timeBasedSell: this.checkTimeBasedSell(position, holdingTime, pnlPercentage),
      takeProfit: this.checkTakeProfit(position, currentPrice, pnlPercentage),
      holdConfidence: this.calculateHoldConfidence(trend, momentum, pnlPercentage),
      holdReasons: this.getHoldReasons(trend, momentum, indicators, pnlPercentage)
    };
  }

  // 🚨 Emergency sell conditions - immediate action required
  async checkEmergencyConditions(symbol, indicators, trend, pnlPercentage) {
    const emergencyConditions = [];
    let confidence = 0;

    // Flash crash detection (>8% drop in 1 hour)
    const hourlyChange = await this.getHourlyPriceChange(symbol);
    if (hourlyChange < -8) {
      emergencyConditions.push(`Flash crash detected: ${hourlyChange.toFixed(2)}% in 1 hour`);
      confidence += 0.9;
    }

    // Extreme RSI oversold with high volume (panic selling)
    if (indicators.rsi < 20 && indicators.volume > indicators.volumeMA * 2) {
      emergencyConditions.push(`Panic selling detected: RSI ${indicators.rsi.toFixed(1)}, High volume`);
      confidence += 0.7;
    }

    // Strong downtrend with accelerating momentum and significant loss
    if (trend.direction === 'STRONG_DOWN' && trend.strength > 0.8 && pnlPercentage < -12) {
      emergencyConditions.push(`Strong downtrend with ${pnlPercentage.toFixed(1)}% loss`);
      confidence += 0.8;
    }

    // MACD showing extreme bearish divergence
    if (indicators.macd.histogram < -0.002 && indicators.macd.macd < indicators.macd.signal * 1.1) {
      emergencyConditions.push(`Extreme bearish MACD divergence`);
      confidence += 0.6;
    }

    // Bollinger Band squeeze with breakdown
    const bbWidth = ((indicators.bollinger.upper - indicators.bollinger.lower) / indicators.bollinger.middle) * 100;
    if (bbWidth < 2 && indicators.currentPrice < indicators.bollinger.lower * 0.98) {
      emergencyConditions.push(`Bollinger band breakdown after squeeze`);
      confidence += 0.7;
    }

    return {
      shouldSell: confidence > 0.7, // High confidence threshold for emergency
      confidence: Math.min(confidence, 1.0),
      details: emergencyConditions
    };
  }

  // 📉 Clear downward trend detection
  async checkTrendReversal(symbol, trend, momentum, indicators, pnlPercentage) {
    const trendConditions = [];
    let confidence = 0;

    // Strong downward trend confirmed by multiple indicators
    if (trend.direction === 'DOWN' || trend.direction === 'STRONG_DOWN') {
      trendConditions.push(`Confirmed downtrend: ${trend.direction} (strength: ${trend.strength.toFixed(2)})`);
      confidence += trend.strength * 0.4;
    }

    // Price below key moving averages with bearish cross
    if (indicators.currentPrice < indicators.sma20 && indicators.sma20 < indicators.sma50) {
      trendConditions.push(`Price below SMA20 and SMA50 with bearish cross`);
      confidence += 0.3;
    }

    // Momentum turning negative
    if (momentum.direction === 'WEAKENING' && momentum.strength > 0.6) {
      trendConditions.push(`Momentum weakening significantly`);
      confidence += 0.2;
    }

    // RSI showing sustained weakness (not just oversold)
    if (indicators.rsi < 45 && this.isRSIWeakening(symbol)) {
      trendConditions.push(`RSI showing sustained weakness trend`);
      confidence += 0.2;
    }

    // Volume confirming the downtrend
    if (indicators.volume > indicators.volumeMA * 1.2) {
      trendConditions.push(`High volume confirming downward move`);
      confidence += 0.2;
    }

    // Significant unrealized loss building up
    if (pnlPercentage < -6) {
      const lossWeight = Math.min(Math.abs(pnlPercentage) / 15, 0.3); // Up to 0.3 weight for 15%+ loss
      trendConditions.push(`Significant unrealized loss: ${pnlPercentage.toFixed(1)}%`);
      confidence += lossWeight;
    }

    // Multiple timeframe confirmation
    const longerTrend = await this.getLongerTimeframeTrend(symbol);
    if (longerTrend === 'DOWN') {
      trendConditions.push(`Longer timeframe also showing downtrend`);
      confidence += 0.2;
    }

    // Smart threshold: higher confidence needed if loss is small
    const requiredConfidence = pnlPercentage > -3 ? 0.8 : 0.6;

    return {
      shouldSell: confidence > requiredConfidence,
      confidence: Math.min(confidence, 1.0),
      details: trendConditions
    };
  }

  // Traditional stop loss check
  checkStopLoss(position, currentPrice, pnlPercentage) {
    const stopLossHit = currentPrice <= position.stopLoss;
    const hardStopPercent = -this.config.riskManagement.stopLossPercentage;
    const hardStopHit = pnlPercentage <= hardStopPercent;

    return {
      shouldSell: stopLossHit || hardStopHit,
      confidence: 1.0,
      details: stopLossHit
        ? [`Stop loss price hit: ${position.stopLoss}`]
        : hardStopHit
          ? [`Hard stop loss hit: ${pnlPercentage.toFixed(1)}%`]
          : []
    };
  }

  // Time-based accept loss (original logic)
  checkTimeBasedSell(position, holdingTime, pnlPercentage) {
    const maxHoldingTime = this.config.tradingPeriods.periodDays * 24 * 60 * 60 * 1000;
    const gracePeriod = this.config.tradingPeriods.gracePeriodHours * 60 * 60 * 1000;
    const acceptLossThreshold = -this.config.tradingPeriods.acceptLossThreshold;

    const isExpired = holdingTime > maxHoldingTime;
    const isInGracePeriod = holdingTime <= (maxHoldingTime + gracePeriod);
    const exceedsLossThreshold = pnlPercentage < acceptLossThreshold;

    const shouldSell = this.config.tradingPeriods.acceptLossAfterPeriod &&
      isExpired &&
      (!isInGracePeriod || exceedsLossThreshold);

    return {
      shouldSell,
      confidence: shouldSell ? 0.8 : 0,
      details: shouldSell ? [
        `Position expired after ${(holdingTime / (24 * 60 * 60 * 1000)).toFixed(1)} days`,
        `Loss ${pnlPercentage.toFixed(1)}% exceeds threshold ${acceptLossThreshold}%`
      ] : []
    };
  }

  // Take profit check
  checkTakeProfit(position, currentPrice, pnlPercentage) {
    const takeProfitHit = currentPrice >= position.takeProfit;
    const profitTargetPercent = this.config.riskManagement.takeProfitPercentage;
    const profitTargetHit = pnlPercentage >= profitTargetPercent;

    return {
      shouldSell: takeProfitHit || profitTargetHit,
      confidence: 1.0,
      details: takeProfitHit
        ? [`Take profit price hit: ${position.takeProfit}`]
        : profitTargetHit
          ? [`Profit target hit: ${pnlPercentage.toFixed(1)}%`]
          : []
    };
  }

  // Calculate confidence in holding the position
  calculateHoldConfidence(trend, momentum, pnlPercentage) {
    let confidence = 0.5; // Base confidence

    // Positive factors for holding
    if (trend.direction === 'UP' || trend.direction === 'STRONG_UP') {
      confidence += trend.strength * 0.3;
    }

    if (momentum.direction === 'STRENGTHENING') {
      confidence += momentum.strength * 0.2;
    }

    if (pnlPercentage > 0) {
      confidence += Math.min(pnlPercentage / 10, 0.2); // Up to 0.2 for 10%+ profit
    }

    // Negative factors
    if (trend.direction === 'DOWN' || trend.direction === 'STRONG_DOWN') {
      confidence -= trend.strength * 0.4;
    }

    if (pnlPercentage < -5) {
      confidence -= Math.min(Math.abs(pnlPercentage) / 20, 0.3); // Reduce confidence for losses
    }

    return Math.max(0, Math.min(1, confidence));
  }

  getHoldReasons(trend, momentum, indicators, pnlPercentage) {
    const reasons = [];

    if (trend.direction === 'UP' || trend.direction === 'STRONG_UP') {
      reasons.push(`Uptrend confirmed (strength: ${trend.strength.toFixed(2)})`);
    }

    if (momentum.direction === 'STRENGTHENING') {
      reasons.push(`Momentum strengthening`);
    }

    if (indicators.rsi > 50 && indicators.rsi < 70) {
      reasons.push(`RSI in healthy range: ${indicators.rsi.toFixed(1)}`);
    }

    if (indicators.currentPrice > indicators.sma20) {
      reasons.push(`Price above SMA20 support`);
    }

    if (pnlPercentage > -3) {
      reasons.push(`Small unrealized loss, room for recovery`);
    }

    return reasons;
  }

  // Helper methods for trend analysis
  async analyzeTrend(symbol, klines) {
    const prices = klines.map(k => parseFloat(k[4])); // Close prices
    const highs = klines.map(k => parseFloat(k[2])); // High prices
    const lows = klines.map(k => parseFloat(k[3])); // Low prices

    // Multiple timeframe trend analysis
    const shortTrend = identifyTrend(prices.slice(-20), 10, 20); // Last 20 periods
    const mediumTrend = identifyTrend(prices.slice(-50), 20, 50); // Last 50 periods
    const longTrend = identifyTrend(prices, 50, 100); // All data

    // Calculate trend strength
    const recentHighs = highs.slice(-10);
    const recentLows = lows.slice(-10);
    const currentPrice = prices[prices.length - 1];

    const highestHigh = Math.max(...recentHighs);
    const lowestLow = Math.min(...recentLows);
    const range = highestHigh - lowestLow;

    // Position within range (0 = at low, 1 = at high)
    const positionInRange = range > 0 ? (currentPrice - lowestLow) / range : 0.5;

    // Trend strength calculation
    let strength = 0;
    let direction = 'SIDEWAYS';

    if (shortTrend === 'UPTREND' && mediumTrend === 'UPTREND') {
      direction = longTrend === 'UPTREND' ? 'STRONG_UP' : 'UP';
      strength = 0.6 + (positionInRange * 0.4);
    } else if (shortTrend === 'DOWNTREND' && mediumTrend === 'DOWNTREND') {
      direction = longTrend === 'DOWNTREND' ? 'STRONG_DOWN' : 'DOWN';
      strength = 0.6 + ((1 - positionInRange) * 0.4);
    } else if (shortTrend === 'UPTREND' || mediumTrend === 'UPTREND') {
      direction = 'WEAK_UP';
      strength = 0.3 + (positionInRange * 0.3);
    } else if (shortTrend === 'DOWNTREND' || mediumTrend === 'DOWNTREND') {
      direction = 'WEAK_DOWN';
      strength = 0.3 + ((1 - positionInRange) * 0.3);
    }

    this.trendCache.set(symbol, { direction, strength, timestamp: Date.now() });

    return { direction, strength };
  }

  async analyzeMomentum(symbol, indicators) {
    const { macd, rsi } = indicators;

    // MACD momentum
    const macdMomentum = macd.histogram > 0 ? 'POSITIVE' : 'NEGATIVE';
    const macdStrength = Math.abs(macd.histogram) * 1000; // Scale for readability

    // RSI momentum (rate of change)
    const previousRSI = await this.getPreviousRSI(symbol);
    const rsiChange = previousRSI ? rsi - previousRSI : 0;

    let direction = 'NEUTRAL';
    let strength = 0;

    if (macdMomentum === 'POSITIVE' && rsiChange > 2) {
      direction = 'STRENGTHENING';
      strength = Math.min((macdStrength + Math.abs(rsiChange)) / 10, 1);
    } else if (macdMomentum === 'NEGATIVE' && rsiChange < -2) {
      direction = 'WEAKENING';
      strength = Math.min((macdStrength + Math.abs(rsiChange)) / 10, 1);
    }

    return { direction, strength };
  }

  async analyzeVolatility(symbol, klines) {
    const prices = klines.map(k => parseFloat(k[4]));
    const returns = [];

    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance);

    this.volatilityCache.set(symbol, volatility);

    // Get historical percentile data
    const percentile = await this.getVolatilityPercentile(symbol, volatility);

    return {
      daily: volatility * Math.sqrt(24 * 4), // Convert 15m to daily
      current: volatility,
      percentile
    };
  }

  // Helper methods
  async getHourlyPriceChange(symbol) {
    try {
      const klines = await this.binance.candlesticks(symbol, '15m', false, { limit: 5 });
      const prices = klines.map(k => parseFloat(k[4]));
      const currentPrice = prices[prices.length - 1];
      const hourAgoPrice = prices[0];

      return ((currentPrice - hourAgoPrice) / hourAgoPrice) * 100;
    } catch (error) {
      logger.error(`Failed to get hourly change for ${symbol}:`, error);
      return 0;
    }
  }

  async getLongerTimeframeTrend(symbol) {
    try {
      const klines = await this.binance.candlesticks(symbol, '1h', false, { limit: 50 });
      const prices = klines.map(k => parseFloat(k[4]));
      return identifyTrend(prices, 20, 50);
    } catch (error) {
      logger.error(`Failed to get longer timeframe trend for ${symbol}:`, error);
      return 'SIDEWAYS';
    }
  }

  async isRSIWeakening(symbol) {
    // Check if RSI has been declining over the last few periods using historical data
    return await this.historicalDataManager.isRSIWeakening(symbol, 3);
  }

  async getPreviousRSI(symbol) {
    // Get RSI from previous period for momentum calculation
    return await this.historicalDataManager.getPreviousRSI(symbol);
  }

  async getVolatilityPercentile(symbol, currentVolatility) {
    // Calculate where current volatility ranks historically
    return await this.historicalDataManager.getVolatilityPercentile(symbol, currentVolatility);
  }

  // Smart position management recommendations
  async getPositionRecommendation(symbol, position) {
    const currentPrice = this.priceCache.get(symbol);
    const decision = await this.shouldSellPosition(symbol, position, currentPrice);

    if (decision.shouldSell) {
      return {
        action: 'SELL',
        reason: decision.reason,
        confidence: decision.confidence,
        urgency: decision.urgency,
        message: `🐶 Bark Trader recommends ${decision.reason}: ${decision.details.join(', ')}`,
        details: decision.details
      };
    }

    return {
      action: 'HOLD',
      reason: 'CONTINUE_POSITION',
      confidence: decision.confidence,
      urgency: 'NONE',
      message: `🐶 Bark Trader says: HOLD! ${decision.details.join(', ')}`,
      details: decision.details
    };
  }
}