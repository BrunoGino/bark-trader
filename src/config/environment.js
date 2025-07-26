import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { logger } from '../utils/logger.js';

class EnvironmentConfig {
  constructor() {
    this.isDocker = process.env.DOCKER_ENV === 'true' || existsSync('/.dockerenv');
    this.nodeEnv = process.env.NODE_ENV || 'development';
    this.isProduction = this.nodeEnv === 'production';
    this.isDevelopment = this.nodeEnv === 'development';

    this.loadEnvironmentFiles();
    this.validateRequiredVariables();
  }

  loadEnvironmentFiles() {
    const rootDir = resolve(process.cwd());

    if (this.isDocker) {
      // In Docker, environment variables are passed through docker-compose.yml
      logger.info('🐳 Running in Docker environment - using container environment variables');
      return;
    }

    // For local development, prefer .env.local
    if (this.isDevelopment) {
      const localEnvPath = resolve(rootDir, '.env.local');
      if (existsSync(localEnvPath)) {
        config({ path: localEnvPath });
        logger.info('📁 Loaded environment from .env.local');
        return;
      } else {
        logger.warn('⚠️  .env.local not found, falling back to .env');
      }
    }

    // For production or fallback, use .env
    const envPath = resolve(rootDir, '.env');
    if (existsSync(envPath)) {
      config({ path: envPath });
      logger.info(`📁 Loaded environment from .env (${this.nodeEnv} mode)`);
    } else {
      logger.warn('⚠️  No .env file found, using default values and system environment');
    }
  }

  validateRequiredVariables() {
    const required = ['BINANCE_API_KEY', 'BINANCE_SECRET_KEY'];
    const missing = required.filter(key => !process.env[key] || process.env[key] === 'your_api_key' || process.env[key] === 'your_secret_key');

    if (missing.length > 0) {
      logger.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
      if (this.isProduction) {
        throw new Error(`Production environment missing required variables: ${missing.join(', ')}`);
      } else {
        logger.warn('🧪 Running with placeholder API keys - trading will be in testnet mode');
      }
    } else {
      logger.info('✅ All required environment variables are set');
    }
  }

  // Database Configuration
  get database() {
    return {
      mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/cryptobot',
        options: {
          maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE) || 10,
          serverSelectionTimeoutMS: parseInt(process.env.MONGODB_TIMEOUT) || 5000,
        }
      },
      redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        options: {
          retryDelayOnFailover: parseInt(process.env.REDIS_RETRY_DELAY) || 100,
          enableOfflineQueue: process.env.REDIS_OFFLINE_QUEUE === 'true',
          maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES) || 3,
        }
      }
    };
  }

  // Binance API Configuration
  get binance() {
    return {
      apiKey: process.env.BINANCE_API_KEY,
      secretKey: process.env.BINANCE_SECRET_KEY,
      testnet: process.env.BINANCE_TESTNET === 'true',
      baseURL: process.env.BINANCE_BASE_URL || 'https://api.binance.com',
      testnetURL: process.env.BINANCE_TESTNET_URL || 'https://testnet.binance.vision',
      verbose: true,
      timeout: parseInt(process.env.BINANCE_TIMEOUT) || 10000,
      recvWindow: parseInt(process.env.BINANCE_RECV_WINDOW) || 60000,
    };
  }

  // Server Configuration
  get server() {
    return {
      port: parseInt(process.env.PORT) || 3000,
      host: process.env.HOST || '0.0.0.0',
      cors: {
        origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:3000', 'http://localhost:3001'],
        credentials: process.env.CORS_CREDENTIALS === 'true',
      },
      trustProxy: process.env.TRUST_PROXY === 'true',
    };
  }

  // Logging Configuration
  get logging() {
    return {
      level: process.env.LOG_LEVEL || (this.isProduction ? 'info' : 'debug'),
      format: process.env.LOG_FORMAT || 'combined',
      maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
      maxSize: process.env.LOG_MAX_SIZE || '20m',
      enableConsole: process.env.LOG_CONSOLE !== 'false',
      enableFile: process.env.LOG_FILE !== 'false',
      directory: process.env.LOG_DIRECTORY || './logs',
    };
  }

  // Trading Configuration
  get trading() {
    return {
      useOriginalBot: process.env.USE_ORIGINAL_BOT === 'true',
      enablePaperTrading: process.env.ENABLE_PAPER_TRADING === 'true',
      maxConcurrentTrades: parseInt(process.env.MAX_CONCURRENT_TRADES) || 5,
      defaultRiskPerTrade: parseFloat(process.env.DEFAULT_RISK_PER_TRADE) || 50,
      emergencyStopLoss: parseFloat(process.env.EMERGENCY_STOP_LOSS) || 1000,
      priceUpdateInterval: parseInt(process.env.PRICE_UPDATE_INTERVAL) || 1000,
    };
  }

  // Security Configuration
  get security() {
    return {
      jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
      sessionSecret: process.env.SESSION_SECRET || 'your-session-secret-change-in-production',
      bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12,
      rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 900000, // 15 minutes
      rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 100,
    };
  }

  // Feature Flags
  get features() {
    return {
      enableSmartLoss: process.env.ENABLE_SMART_LOSS !== 'false',
      enableWebSocket: process.env.ENABLE_WEBSOCKET !== 'false',
      enableMetrics: process.env.ENABLE_METRICS === 'true',
      enableSwagger: process.env.ENABLE_SWAGGER !== 'false',
      enableRateLimiting: process.env.ENABLE_RATE_LIMITING !== 'false',
      debugMode: process.env.DEBUG_MODE === 'true',
    };
  }

  // Get all configuration as a single object
  get all() {
    return {
      environment: {
        nodeEnv: this.nodeEnv,
        isProduction: this.isProduction,
        isDevelopment: this.isDevelopment,
        isDocker: this.isDocker,
      },
      database: this.database,
      binance: this.binance,
      server: this.server,
      logging: this.logging,
      trading: this.trading,
      security: this.security,
      features: this.features,
    };
  }

  // Method to safely log configuration (without secrets)
  logConfiguration() {
    const safeConfig = {
      environment: {
        nodeEnv: this.nodeEnv,
        isProduction: this.isProduction,
        isDevelopment: this.isDevelopment,
        isDocker: this.isDocker,
      },
      database: {
        mongodb: { uri: this.maskConnectionString(this.database.mongodb.uri) },
        redis: { url: this.maskConnectionString(this.database.redis.url) },
      },
      binance: {
        apiKey: this.maskSecret(this.binance.apiKey),
        testnet: this.binance.testnet,
        baseURL: this.binance.baseURL,
      },
      server: this.server,
      logging: this.logging,
      trading: this.trading,
      features: this.features,
    };

    logger.info('🔧 Environment Configuration:', safeConfig);
  }

  maskSecret(secret) {
    if (!secret || secret.length < 8) return '[NOT_SET]';
    return secret.substring(0, 4) + '****' + secret.substring(secret.length - 4);
  }

  maskConnectionString(uri) {
    if (!uri) return '[NOT_SET]';
    return uri.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
  }
}

// Create and export a singleton instance
export const env = new EnvironmentConfig();

// Export individual configurations for convenience
export const {
  database: dbConfig,
  binance: binanceConfig,
  server: serverConfig,
  logging: loggingConfig,
  trading: tradingConfig,
  security: securityConfig,
  features: featureFlags
} = env;

// Default export
export default env;