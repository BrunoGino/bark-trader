// Historical Data Manager for SmartLossManager
import { redis } from '../database/redis.js';
import { logger } from '../utils/logger.js';

export class HistoricalDataManager {
  constructor() {
    this.maxHistoryPoints = 100;
    this.volatilityHistoryDays = 30;
  }

  // RSI Historical Data Management
  async storeRSI(symbol, rsi, timestamp = Date.now()) {
    try {
      const key = `rsi_history:${symbol}`;
      const dataPoint = JSON.stringify({ value: rsi, timestamp });
      
      await redis.lPush(key, dataPoint);
      await redis.lTrim(key, 0, this.maxHistoryPoints - 1);
      await redis.expire(key, 86400); // 24 hours TTL
      
      logger.debug(`Stored RSI ${rsi} for ${symbol}`);
    } catch (error) {
      logger.error(`Failed to store RSI for ${symbol}:`, error);
    }
  }

  async getRSIHistory(symbol, count = 10) {
    try {
      const key = `rsi_history:${symbol}`;
      const history = await redis.lRange(key, 0, count - 1);
      
      return history.map(item => {
        const parsed = JSON.parse(item);
        return {
          value: parseFloat(parsed.value),
          timestamp: parsed.timestamp
        };
      }).reverse(); // Most recent first
    } catch (error) {
      logger.error(`Failed to get RSI history for ${symbol}:`, error);
      return [];
    }
  }

  async isRSIWeakening(symbol, periods = 3) {
    try {
      const history = await this.getRSIHistory(symbol, periods + 1);
      
      if (history.length < periods) return false;
      
      // Check if RSI is consistently declining
      for (let i = 1; i < periods; i++) {
        if (history[i].value >= history[i - 1].value) {
          return false; // Not consistently declining
        }
      }
      
      const totalDecline = history[0].value - history[periods - 1].value;
      return totalDecline > 5; // Decline by more than 5 RSI points
    } catch (error) {
      logger.error(`Failed to check RSI weakening for ${symbol}:`, error);
      return false;
    }
  }

  async getPreviousRSI(symbol) {
    try {
      const history = await this.getRSIHistory(symbol, 2);
      return history.length >= 2 ? history[1].value : null;
    } catch (error) {
      logger.error(`Failed to get previous RSI for ${symbol}:`, error);
      return null;
    }
  }

  // Volatility Historical Data Management
  async storeVolatility(symbol, volatility, timestamp = Date.now()) {
    try {
      const key = `volatility_history:${symbol}`;
      const dataPoint = JSON.stringify({ value: volatility, timestamp });
      
      await redis.lPush(key, dataPoint);
      await redis.lTrim(key, 0, this.maxHistoryPoints - 1);
      await redis.expire(key, 86400 * this.volatilityHistoryDays); // 30 days TTL
      
      logger.debug(`Stored volatility ${volatility} for ${symbol}`);
    } catch (error) {
      logger.error(`Failed to store volatility for ${symbol}:`, error);
    }
  }

  async getVolatilityHistory(symbol, count = 50) {
    try {
      const key = `volatility_history:${symbol}`;
      const history = await redis.lRange(key, 0, count - 1);
      
      return history.map(item => {
        const parsed = JSON.parse(item);
        return {
          value: parseFloat(parsed.value),
          timestamp: parsed.timestamp
        };
      }).reverse();
    } catch (error) {
      logger.error(`Failed to get volatility history for ${symbol}:`, error);
      return [];
    }
  }

  async getVolatilityPercentile(symbol, currentVolatility) {
    try {
      const history = await this.getVolatilityHistory(symbol, 50);
      
      if (history.length < 10) return 0.5; // Default if insufficient data
      
      const values = history.map(h => h.value).sort((a, b) => a - b);
      
      // Find percentile rank of current volatility
      let rank = 0;
      for (let i = 0; i < values.length; i++) {
        if (values[i] <= currentVolatility) {
          rank = i + 1;
        } else {
          break;
        }
      }
      
      const percentile = rank / values.length;
      logger.debug(`Volatility percentile for ${symbol}: ${percentile.toFixed(2)}`);
      
      return percentile;
    } catch (error) {
      logger.error(`Failed to calculate volatility percentile for ${symbol}:`, error);
      return 0.5;
    }
  }

  // Price History Management (for getRecentPrices)
  async storePriceUpdate(symbol, price, timestamp = Date.now()) {
    try {
      const key = `price_history:${symbol}`;
      const dataPoint = JSON.stringify({ price: parseFloat(price), timestamp });
      
      await redis.lPush(key, dataPoint);
      await redis.lTrim(key, 0, this.maxHistoryPoints - 1);
      await redis.expire(key, 7200); // 2 hours TTL for price data
      
    } catch (error) {
      logger.error(`Failed to store price for ${symbol}:`, error);
    }
  }

  async getRecentPrices(symbol, count = 50) {
    try {
      const key = `price_history:${symbol}`;
      const history = await redis.lRange(key, 0, count - 1);
      
      return history.map(item => {
        const parsed = JSON.parse(item);
        return parseFloat(parsed.price);
      }).reverse(); // Oldest first for calculations
    } catch (error) {
      logger.error(`Failed to get recent prices for ${symbol}:`, error);
      return [];
    }
  }

  // Utility method to clean up old data
  async cleanupOldData(symbol) {
    try {
      const keys = [
        `rsi_history:${symbol}`,
        `volatility_history:${symbol}`,
        `price_history:${symbol}`
      ];
      
      for (const key of keys) {
        const exists = await redis.exists(key);
        if (exists) {
          await redis.expire(key, 3600); // Reset TTL to 1 hour
        }
      }
    } catch (error) {
      logger.error(`Failed to cleanup old data for ${symbol}:`, error);
    }
  }

  // Batch store indicators (called after calculating technical indicators)
  async storeIndicatorsBatch(symbol, indicators) {
    try {
      const timestamp = Date.now();
      
      await Promise.all([
        this.storeRSI(symbol, indicators.rsi, timestamp),
        this.storeVolatility(symbol, indicators.volatility || 0, timestamp),
        this.storePriceUpdate(symbol, indicators.currentPrice, timestamp)
      ]);
      
    } catch (error) {
      logger.error(`Failed to store indicators batch for ${symbol}:`, error);
    }
  }
}