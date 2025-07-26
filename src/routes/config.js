import express from 'express';
import Joi from 'joi';
import { TradingConfig } from '../models/TradingConfig.js';
import { logger } from '../utils/logger.js';
import { tradingBot } from '../index.js';

const router = express.Router();

// Validation schemas
const configUpdateSchema = Joi.object({
  activeSymbols: Joi.array().items(Joi.string().min(6).max(10)).min(1).max(20),
  maxConcurrentTrades: Joi.number().integer().min(1).max(20),
  maxLossPerTrade: Joi.number().min(1).max(1000),
  maxTotalLoss: Joi.number().min(1).max(10000),
  tradingWindowMinutes: Joi.number().integer().min(1).max(1440),
  maxDailyGainPercent: Joi.number().min(0.1).max(50),
  minGainPercent: Joi.number().min(0.1).max(20),
  stopLossPercent: Joi.number().min(0.1).max(10),
  takeProfitPercent: Joi.number().min(0.1).max(50),
  riskPercentPerTrade: Joi.number().min(0.1).max(10),
  baseOrderSize: Joi.number().min(1).max(1000),
  technicalSettings: Joi.object({
    rsiPeriod: Joi.number().integer().min(5).max(50),
    rsiBuyThreshold: Joi.number().min(10).max(50),
    rsiSellThreshold: Joi.number().min(50).max(90),
    macdFastPeriod: Joi.number().integer().min(5).max(50),
    macdSlowPeriod: Joi.number().integer().min(10).max(100),
    macdSignalPeriod: Joi.number().integer().min(5).max(50),
    smaShortPeriod: Joi.number().integer().min(5).max(100),
    smaLongPeriod: Joi.number().integer().min(20).max(200)
  }),
  strategySettings: Joi.object({
    strategy: Joi.string().valid('rsi_sma', 'macd', 'bollinger', 'momentum', 'mean_reversion'),
    enableStopLoss: Joi.boolean(),
    enableTakeProfit: Joi.boolean(),
    enableTrailingStop: Joi.boolean(),
    trailingStopPercent: Joi.number().min(0.1).max(5)
  }),
  marketFilters: Joi.object({
    minVolume24h: Joi.number().min(0),
    maxVolatility: Joi.number().min(0).max(100),
    blacklistSymbols: Joi.array().items(Joi.string())
  }),
  timeRestrictions: Joi.object({
    tradingHours: Joi.object({
      start: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
      end: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
    }),
    timezone: Joi.string(),
    pauseDuringNews: Joi.boolean()
  }),
  isActive: Joi.boolean(),
  testMode: Joi.boolean(),
  enableWebhooks: Joi.boolean(),
  webhookUrl: Joi.string().uri().allow(''),
  logLevel: Joi.string().valid('error', 'warn', 'info', 'debug'),
  enableDetailedLogging: Joi.boolean(),
  description: Joi.string().max(500)
});

const symbolSchema = Joi.object({
  symbol: Joi.string().min(6).max(10).required()
});

const symbolsUpdateSchema = Joi.object({
  symbols: Joi.array().items(Joi.string().min(6).max(10)).min(1).max(20).required()
});

// Get current configuration
router.get('/', async (req, res) => {
  try {
    const config = await TradingConfig.findOne({}) || await TradingConfig.createDefault();
    
    res.json({
      success: true,
      data: { config }
    });

  } catch (error) {
    logger.error('Get config error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve configuration'
    });
  }
});

// Update configuration
router.put('/', async (req, res) => {
  try {
    // Validate request body
    const { error, value } = configUpdateSchema.validate(req.body, { 
      allowUnknown: false,
      stripUnknown: true 
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    // Find existing config or create new one
    let config = await TradingConfig.findOne({});
    
    if (config) {
      // Update existing config
      Object.assign(config, value);
      config.lastModified = new Date();
      config.modifiedBy = req.ip || 'unknown';
    } else {
      // Create new config
      config = new TradingConfig({
        ...value,
        modifiedBy: req.ip || 'unknown'
      });
    }

    await config.save();

    // Restart trading bot with new config if it's running
    if (tradingBot && tradingBot.isRunning) {
      logger.info('Restarting trading bot with new configuration...');
      await tradingBot.stop();
      tradingBot.config = config;
      await tradingBot.initialize();
      await tradingBot.start();
    }

    res.json({
      success: true,
      data: { 
        config,
        message: 'Configuration updated successfully'
      }
    });

  } catch (error) {
    logger.error('Update config error:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: 'Configuration validation failed',
        details: Object.values(error.errors).map(e => e.message)
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to update configuration'
    });
  }
});

// Get active trading symbols
router.get('/symbols', async (req, res) => {
  try {
    const config = await TradingConfig.findOne({});
    
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }

    res.json({
      success: true,
      data: {
        activeSymbols: config.activeSymbols,
        maxConcurrentTrades: config.maxConcurrentTrades,
        count: config.activeSymbols.length
      }
    });

  } catch (error) {
    logger.error('Get symbols error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve symbols'
    });
  }
});

// Update active trading symbols
router.put('/symbols', async (req, res) => {
  try {
    // Validate request body
    const { error, value } = symbolsUpdateSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const config = await TradingConfig.findOne({});
    
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }

    // Check if symbols count exceeds max concurrent trades
    if (value.symbols.length > config.maxConcurrentTrades) {
      return res.status(400).json({
        success: false,
        error: `Number of symbols (${value.symbols.length}) exceeds max concurrent trades (${config.maxConcurrentTrades})`
      });
    }

    // Normalize symbols to uppercase
    const normalizedSymbols = value.symbols.map(symbol => symbol.toUpperCase());
    
    config.activeSymbols = normalizedSymbols;
    config.lastModified = new Date();
    config.modifiedBy = req.ip || 'unknown';

    await config.save();

    // Update trading bot configuration
    if (tradingBot) {
      tradingBot.config = config;
      
      // Restart price streams with new symbols
      if (tradingBot.isRunning) {
        tradingBot.setupPriceStreams();
      }
    }

    res.json({
      success: true,
      data: {
        activeSymbols: config.activeSymbols,
        message: 'Trading symbols updated successfully'
      }
    });

  } catch (error) {
    logger.error('Update symbols error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update symbols'
    });
  }
});

// Add single symbol
router.post('/symbols', async (req, res) => {
  try {
    // Validate request body
    const { error, value } = symbolSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const config = await TradingConfig.findOne({});
    
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }

    const symbol = value.symbol.toUpperCase();

    // Check if symbol already exists
    if (config.activeSymbols.includes(symbol)) {
      return res.status(400).json({
        success: false,
        error: `Symbol ${symbol} is already active`
      });
    }

    // Check max concurrent trades limit
    if (config.activeSymbols.length >= config.maxConcurrentTrades) {
      return res.status(400).json({
        success: false,
        error: `Cannot add more symbols. Max concurrent trades limit (${config.maxConcurrentTrades}) reached`
      });
    }

    config.activeSymbols.push(symbol);
    config.lastModified = new Date();
    config.modifiedBy = req.ip || 'unknown';

    await config.save();

    // Update trading bot configuration
    if (tradingBot) {
      tradingBot.config = config;
      
      if (tradingBot.isRunning) {
        tradingBot.setupPriceStreams();
      }
    }

    res.json({
      success: true,
      data: {
        activeSymbols: config.activeSymbols,
        addedSymbol: symbol,
        message: `Symbol ${symbol} added successfully`
      }
    });

  } catch (error) {
    logger.error('Add symbol error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add symbol'
    });
  }
});

// Remove single symbol
router.delete('/symbols/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const config = await TradingConfig.findOne({});
    
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }

    // Check if symbol exists in active symbols
    if (!config.activeSymbols.includes(symbol)) {
      return res.status(404).json({
        success: false,
        error: `Symbol ${symbol} is not in active symbols`
      });
    }

    // Check if this would leave us with no symbols
    if (config.activeSymbols.length <= 1) {
      return res.status(400).json({
        success: false,
        error: 'Cannot remove the last active symbol'
      });
    }

    // Close any active position for this symbol
    if (tradingBot && tradingBot.activeOrders.has(symbol)) {
      logger.info(`Closing active position for ${symbol} before removing from config`);
      // This would trigger the bot to close the position
      // Implementation depends on your trading bot's close position method
    }

    config.activeSymbols = config.activeSymbols.filter(s => s !== symbol);
    config.lastModified = new Date();
    config.modifiedBy = req.ip || 'unknown';

    await config.save();

    // Update trading bot configuration
    if (tradingBot) {
      tradingBot.config = config;
      
      if (tradingBot.isRunning) {
        tradingBot.setupPriceStreams();
      }
    }

    res.json({
      success: true,
      data: {
        activeSymbols: config.activeSymbols,
        removedSymbol: symbol,
        message: `Symbol ${symbol} removed successfully`
      }
    });

  } catch (error) {
    logger.error('Remove symbol error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove symbol'
    });
  }
});

// Get risk limits
router.get('/limits', async (req, res) => {
  try {
    const config = await TradingConfig.findOne({});
    
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }

    const limits = {
      maxLossPerTrade: config.maxLossPerTrade,
      maxTotalLoss: config.maxTotalLoss,
      maxConcurrentTrades: config.maxConcurrentTrades,
      maxDailyGainPercent: config.maxDailyGainPercent,
      minGainPercent: config.minGainPercent,
      stopLossPercent: config.stopLossPercent,
      takeProfitPercent: config.takeProfitPercent,
      riskPercentPerTrade: config.riskPercentPerTrade,
      baseOrderSize: config.baseOrderSize
    };

    res.json({
      success: true,
      data: { limits }
    });

  } catch (error) {
    logger.error('Get limits error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve limits'
    });
  }
});

// Update risk limits
router.put('/limits', async (req, res) => {
  try {
    const limitsSchema = Joi.object({
      maxLossPerTrade: Joi.number().min(1).max(1000),
      maxTotalLoss: Joi.number().min(1).max(10000),
      maxConcurrentTrades: Joi.number().integer().min(1).max(20),
      maxDailyGainPercent: Joi.number().min(0.1).max(50),
      minGainPercent: Joi.number().min(0.1).max(20),
      stopLossPercent: Joi.number().min(0.1).max(10),
      takeProfitPercent: Joi.number().min(0.1).max(50),
      riskPercentPerTrade: Joi.number().min(0.1).max(10),
      baseOrderSize: Joi.number().min(1).max(1000)
    }).min(1);

    const { error, value } = limitsSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }

    const config = await TradingConfig.findOne({});
    
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }

    // Update only provided fields
    Object.assign(config, value);
    config.lastModified = new Date();
    config.modifiedBy = req.ip || 'unknown';

    await config.save();

    // Update trading bot configuration
    if (tradingBot) {
      tradingBot.config = config;
    }

    res.json({
      success: true,
      data: {
        limits: {
          maxLossPerTrade: config.maxLossPerTrade,
          maxTotalLoss: config.maxTotalLoss,
          maxConcurrentTrades: config.maxConcurrentTrades,
          maxDailyGainPercent: config.maxDailyGainPercent,
          minGainPercent: config.minGainPercent,
          stopLossPercent: config.stopLossPercent,
          takeProfitPercent: config.takeProfitPercent,
          riskPercentPerTrade: config.riskPercentPerTrade,
          baseOrderSize: config.baseOrderSize
        },
        message: 'Risk limits updated successfully'
      }
    });

  } catch (error) {
    logger.error('Update limits error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update limits'
    });
  }
});

// Reset configuration to defaults
router.post('/reset', async (req, res) => {
  try {
    // Stop trading bot if running
    if (tradingBot && tradingBot.isRunning) {
      await tradingBot.stop();
    }

    // Delete existing config
    await TradingConfig.deleteMany({});

    // Create default config
    const defaultConfig = await TradingConfig.createDefault();
    await defaultConfig.save();

    // Restart trading bot with default config
    if (tradingBot) {
      tradingBot.config = defaultConfig;
      await tradingBot.initialize();
    }

    res.json({
      success: true,
      data: {
        config: defaultConfig,
        message: 'Configuration reset to defaults successfully'
      }
    });

  } catch (error) {
    logger.error('Reset config error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset configuration'
    });
  }
});

export default router;