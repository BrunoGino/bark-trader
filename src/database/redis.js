import { createClient } from 'redis';
import { logger } from '../utils/logger.js';
import { dbConfig } from '../config/environment.js';

let redis = null;

export async function connectRedis() {
  try {
    redis = createClient({
      url: dbConfig.redis.url,
      retry_unfulfilled_commands: true,
      retry_delay_on_failover: dbConfig.redis.options.retryDelayOnFailover,
      enable_offline_queue: dbConfig.redis.options.enableOfflineQueue,
      socket: {
        connectTimeout: 10000,
        commandTimeout: 5000,
      }
    });

    redis.on('error', (error) => {
      logger.error('Redis connection error:', error);
    });

    redis.on('connect', () => {
      logger.info('🔴 Connected to Redis');
    });

    redis.on('reconnecting', () => {
      logger.info('Redis reconnecting...');
    });

    redis.on('ready', () => {
      logger.info('Redis client ready');
    });

    await redis.connect();
    
    // Test the connection
    await redis.ping();
    
    return redis;
  } catch (error) {
    logger.error('Failed to connect to Redis:', error);
    throw error;
  }
}

export async function disconnectRedis() {
  try {
    if (redis) {
      await redis.quit();
      logger.info('Disconnected from Redis');
    }
  } catch (error) {
    logger.error('Error disconnecting from Redis:', error);
  }
}

// Redis utility functions
export const RedisKeys = {
  ACTIVE_ORDERS: 'active_orders',
  DAILY_STATS: 'daily_stats',
  PRICE_CACHE: 'price_cache',
  USER_SESSIONS: 'user_sessions',
  ORDER_UPDATES: 'order_updates',
  
  // Generate dynamic keys
  dailyStatsKey: (date) => `daily_stats:${date}`,
  priceKey: (symbol) => `price:${symbol}`,
  orderKey: (orderId) => `order:${orderId}`,
  symbolStatsKey: (symbol, date) => `stats:${symbol}:${date}`,
};

// Cache management utilities
export const CacheManager = {
  async setWithExpiry(key, value, ttlSeconds = 3600) {
    if (!redis) throw new Error('Redis not connected');
    await redis.setEx(key, ttlSeconds, JSON.stringify(value));
  },

  async get(key) {
    if (!redis) throw new Error('Redis not connected');
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  },

  async getHashAll(key) {
    if (!redis) throw new Error('Redis not connected');
    return await redis.hGetAll(key);
  },

  async setHash(key, field, value) {
    if (!redis) throw new Error('Redis not connected');
    await redis.hSet(key, field, JSON.stringify(value));
  },

  async deleteHash(key, field) {
    if (!redis) throw new Error('Redis not connected');
    await redis.hDel(key, field);
  },

  async exists(key) {
    if (!redis) throw new Error('Redis not connected');
    return await redis.exists(key);
  },

  async expire(key, ttlSeconds) {
    if (!redis) throw new Error('Redis not connected');
    await redis.expire(key, ttlSeconds);
  },

  async deleteKey(key) {
    if (!redis) throw new Error('Redis not connected');
    await redis.del(key);
  },

  async getKeys(pattern) {
    if (!redis) throw new Error('Redis not connected');
    return await redis.keys(pattern);
  }
};

export { redis };