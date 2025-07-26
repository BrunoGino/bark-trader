import express from 'express';
import Joi from 'joi';
import { EnhancedTradingConfig } from '../models/EnhancedTradingConfig.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Validation schemas for Bark Trader 🐶
const portfolioConfigSchema = Joi.object({
  totalCapital: Joi.number().min(1).max(1000000),
  maxLossPercentage: Joi.number().min(1).max(50),
  maxActiveSymbols: Joi.number().integer().min(1).max(20),
  maxConcurrentOrders: Joi.number().integer().min(1).max(50),
  reservePercentage: Joi.number().min(0).max(30)
});

const tradingPeriodsSchema = Joi.object({
  defaultPeriod: Joi.string().valid('day', 'week', 'month', 'quarter'),
  periodDays: Joi.number().integer().min(1).max(365),
  acceptLossAfterPeriod: Joi.boolean(),
  acceptLossThreshold: Joi.number().min(1).max(20),
  gracePeriodHours: Joi.number().integer().min(1).max(168)
});

const positionSizingSchema = Joi.object({
  strategy: Joi.string().valid('equal_weight', 'risk_parity', 'kelly_criterion', 'fixed_amount'),
  minPositionSize: Joi.number().min(1),
  maxPositionSize: Joi.number().min(1),
  dynamicSizing: Joi.boolean()
});

// 🐶 Get current Bark Trader configuration
router.get('/', async (req, res) => {
  try {
    const config = await EnhancedTradingConfig.findOne({}) ||
      await EnhancedTradingConfig.createOptimizedConfig(50);

    // Calculate derived values
    const derivedValues = {
      maxTotalLossAmount: config.maxTotalLossAmount,
      reserveAmount: config.reserveAmount,
      availableCapital: config.availableCapital,
      maxPositionSizeCalculated: config.maxPositionSizeCalculated,
      estimatedOrdersPerSymbol: Math.floor(config.availableCapital / config.positionSizing.minPositionSize / config.portfolioSettings.maxActiveSymbols)
    };

    res.json({
      success: true,
      data: {
        config,
        derivedValues,
        message: 'Bark Trader configuration retrieved successfully 🐶'
      }
    });

  } catch (error) {
    logger.error('Get enhanced config error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve Bark Trader configuration'
    });
  }
});

// 🎯 Update portfolio settings
router.put('/portfolio', async (req, res) => {
  try {
    const { error, value } = portfolioConfigSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Portfolio validation error',
        details: error.details.map(d => d.message)
      });
    }

    const config = await EnhancedTradingConfig.findOne({});
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Bark Trader configuration not found'
      });
    }

    // Validate logical constraints
    if (value.totalCapital && value.maxLossPercentage) {
      const maxLoss = (value.totalCapital * value.maxLossPercentage) / 100;
      if (maxLoss < 5) {
        return res.status(400).json({
          success: false,
          error: 'Maximum loss amount must be at least $5'
        });
      }
    }

    Object.assign(config.portfolioSettings, value);
    config.lastModified = new Date();
    await config.save();

    const derivedValues = {
      maxTotalLossAmount: config.maxTotalLossAmount,
      availableCapital: config.availableCapital,
      maxPositionSizeCalculated: config.maxPositionSizeCalculated
    };

    res.json({
      success: true,
      data: {
        portfolioSettings: config.portfolioSettings,
        derivedValues,
        message: 'Portfolio settings updated successfully 🐶'
      }
    });

  } catch (error) {
    logger.error('Update portfolio settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update portfolio settings'
    });
  }
});

// ⏰ Update trading periods and accept loss mechanism
router.put('/periods', async (req, res) => {
  try {
    const { error, value } = tradingPeriodsSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Trading periods validation error',
        details: error.details.map(d => d.message)
      });
    }

    const config = await EnhancedTradingConfig.findOne({});
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }

    Object.assign(config.tradingPeriods, value);
    config.lastModified = new Date();
    await config.save();

    res.json({
      success: true,
      data: {
        tradingPeriods: config.tradingPeriods,
        message: 'Trading periods updated successfully 🐶'
      }
    });

  } catch (error) {
    logger.error('Update trading periods error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update trading periods'
    });
  }
});

// 💰 Update position sizing strategy
router.put('/position-sizing', async (req, res) => {
  try {
    const { error, value } = positionSizingSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Position sizing validation error',
        details: error.details.map(d => d.message)
      });
    }

    const config = await EnhancedTradingConfig.findOne({});
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }

    // Validate position size constraints
    if (value.maxPositionSize && value.minPositionSize) {
      if (value.maxPositionSize <= value.minPositionSize) {
        return res.status(400).json({
          success: false,
          error: 'Maximum position size must be greater than minimum position size'
        });
      }
    }

    Object.assign(config.positionSizing, value);
    config.lastModified = new Date();
    await config.save();

    res.json({
      success: true,
      data: {
        positionSizing: config.positionSizing,
        message: 'Position sizing strategy updated successfully 🐶'
      }
    });

  } catch (error) {
    logger.error('Update position sizing error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update position sizing strategy'
    });
  }
});

// 📊 Quick setup for different capital amounts
router.post('/quick-setup/:capitalAmount', async (req, res) => {
  try {
    const capitalAmount = parseFloat(req.params.capitalAmount);

    if (isNaN(capitalAmount) || capitalAmount < 10 || capitalAmount > 100000) {
      return res.status(400).json({
        success: false,
        error: 'Capital amount must be between $10 and $100,000'
      });
    }

    // Delete existing config
    await EnhancedTradingConfig.deleteMany({});

    // Create optimized config for the capital amount
    const config = EnhancedTradingConfig.createOptimizedConfig(capitalAmount);

    // Adjust settings based on capital amount
    if (capitalAmount >= 100) {
      config.portfolioSettings.maxActiveSymbols = 7;
      config.portfolioSettings.maxConcurrentOrders = Math.floor(capitalAmount / 5);
      config.positionSizing.maxPositionSize = Math.min(capitalAmount * 0.25, 50);
    } else {
      config.portfolioSettings.maxActiveSymbols = 5;
      config.portfolioSettings.maxConcurrentOrders = Math.floor(capitalAmount / 3);
      config.positionSizing.maxPositionSize = capitalAmount * 0.3;
    }

    // Adjust risk based on capital
    if (capitalAmount <= 50) {
      config.portfolioSettings.maxLossPercentage = 20; // More conservative for small amounts
      config.riskManagement.stopLossPercentage = 8;
    } else if (capitalAmount <= 200) {
      config.portfolioSettings.maxLossPercentage = 18;
      config.riskManagement.stopLossPercentage = 7;
    } else {
      config.portfolioSettings.maxLossPercentage = 15;
      config.riskManagement.stopLossPercentage = 6;
    }

    await config.save();

    const derivedValues = {
      maxTotalLossAmount: config.maxTotalLossAmount,
      availableCapital: config.availableCapital,
      maxPositionSizeCalculated: config.maxPositionSizeCalculated,
      estimatedDailyTrades: Math.floor(config.portfolioSettings.maxConcurrentOrders / 3)
    };

    res.json({
      success: true,
      data: {
        config,
        derivedValues,
        message: `🐶 Bark Trader optimized for ${capitalAmount} capital! Woof!`
      }
    });

  } catch (error) {
    logger.error('Quick setup error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create quick setup'
    });
  }
});

// 🎯 Trading style configuration (day trading vs swing trading)
router.put('/trading-style', async (req, res) => {
  try {
    const tradingStyleSchema = Joi.object({
      dayTrading: Joi.object({
        enabled: Joi.boolean(),
        maxHoldingPeriodHours: Joi.number().integer().min(1).max(168),
        quickProfitTarget: Joi.number().min(0.5).max(10)
      }),
      swingTrading: Joi.object({
        enabled: Joi.boolean(),
        maxHoldingPeriodDays: Joi.number().integer().min(1).max(30),
        targetProfitRange: Joi.object({
          min: Joi.number().min(1).max(50),
          max: Joi.number().min(1).max(100)
        })
      })
    });

    const { error, value } = tradingStyleSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Trading style validation error',
        details: error.details.map(d => d.message)
      });
    }

    const config = await EnhancedTradingConfig.findOne({});
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }

    // Validate profit target ranges
    if (value.swingTrading?.targetProfitRange) {
      const { min, max } = value.swingTrading.targetProfitRange;
      if (min >= max) {
        return res.status(400).json({
          success: false,
          error: 'Swing trading minimum target must be less than maximum target'
        });
      }
    }

    Object.assign(config.tradingStyle, value);
    config.lastModified = new Date();
    await config.save();

    res.json({
      success: true,
      data: {
        tradingStyle: config.tradingStyle,
        message: 'Trading style updated successfully 🐶'
      }
    });

  } catch (error) {
    logger.error('Update trading style error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update trading style'
    });
  }
});

// 🛡️ Risk management settings
router.put('/risk-management', async (req, res) => {
  try {
    const riskManagementSchema = Joi.object({
      stopLossPercentage: Joi.number().min(1).max(20),
      takeProfitPercentage: Joi.number().min(1).max(100),
      enableTrailingStop: Joi.boolean(),
      trailingStopPercentage: Joi.number().min(1).max(15),
      maxCorrelation: Joi.number().min(0).max(1)
    });

    const { error, value } = riskManagementSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Risk management validation error',
        details: error.details.map(d => d.message)
      });
    }

    const config = await EnhancedTradingConfig.findOne({});
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }

    Object.assign(config.riskManagement, value);
    config.lastModified = new Date();
    await config.save();

    res.json({
      success: true,
      data: {
        riskManagement: config.riskManagement,
        message: 'Risk management settings updated successfully 🐶'
      }
    });

  } catch (error) {
    logger.error('Update risk management error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update risk management settings'
    });
  }
});

// 📈 Get risk analysis for current settings
router.get('/risk-analysis', async (req, res) => {
  try {
    const config = await EnhancedTradingConfig.findOne({});
    if (!config) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }

    const analysis = {
      capitalAllocation: {
        totalCapital: config.portfolioSettings.totalCapital,
        maxLossAmount: config.maxTotalLossAmount,
        reserveAmount: config.reserveAmount,
        tradingCapital: config.availableCapital,
        riskPercentage: config.portfolioSettings.maxLossPercentage
      },
      positionLimits: {
        maxActiveSymbols: config.portfolioSettings.maxActiveSymbols,
        maxConcurrentOrders: config.portfolioSettings.maxConcurrentOrders,
        minPositionSize: config.positionSizing.minPositionSize,
        maxPositionSize: config.positionSizing.maxPositionSize,
        optimalPositionSize: config.maxPositionSizeCalculated
      },
      timeHorizons: {
        defaultTradingPeriod: `${config.tradingPeriods.periodDays} days`,
        acceptLossAfterPeriod: config.tradingPeriods.acceptLossAfterPeriod,
        acceptLossThreshold: `${config.tradingPeriods.acceptLossThreshold}%`,
        gracePeriod: `${config.tradingPeriods.gracePeriodHours} hours`
      },
      riskMetrics: {
        stopLossPerPosition: `${config.riskManagement.stopLossPercentage}%`,
        takeProfitTarget: `${config.riskManagement.takeProfitPercentage}%`,
        trailingStopEnabled: config.riskManagement.enableTrailingStop,
        maxPortfolioCorrelation: config.riskManagement.maxCorrelation
      },
      estimatedScenarios: {
        maxDailyTrades: Math.floor(config.portfolioSettings.maxConcurrentOrders / 2),
        worstCaseScenario: {
          allPositionsStopLoss: -(config.availableCapital * config.riskManagement.stopLossPercentage / 100),
          maxTotalLoss: -config.maxTotalLossAmount
        },
        bestCaseScenario: {
          allPositionsTakeProfit: config.availableCapital * config.riskManagement.takeProfitPercentage / 100
        }
      },
      recommendations: []
    };

    // Generate recommendations
    const riskToCapitalRatio = config.maxTotalLossAmount / config.portfolioSettings.totalCapital;
    if (riskToCapitalRatio > 0.25) {
      analysis.recommendations.push({
        type: 'warning',
        message: 'Risk exposure is high relative to capital. Consider reducing max loss percentage.'
      });
    }

    if (config.positionSizing.maxPositionSize > config.portfolioSettings.totalCapital * 0.4) {
      analysis.recommendations.push({
        type: 'warning',
        message: 'Maximum position size is large. Consider reducing to improve diversification.'
      });
    }

    if (config.portfolioSettings.maxActiveSymbols < 3) {
      analysis.recommendations.push({
        type: 'info',
        message: 'Consider increasing active symbols for better diversification.'
      });
    }

    if (!config.tradingPeriods.acceptLossAfterPeriod) {
      analysis.recommendations.push({
        type: 'info',
        message: 'Accept loss mechanism is disabled. Positions may be held indefinitely.'
      });
    }

    res.json({
      success: true,
      data: {
        analysis,
        message: 'Risk analysis completed successfully 🐶'
      }
    });

  } catch (error) {
    logger.error('Risk analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate risk analysis'
    });
  }
});

// 🎛️ Preset configurations for different trading styles
router.get('/presets', (req, res) => {
  const presets = {
    conservative: {
      name: 'Conservative Trader 🛡️',
      description: 'Low risk, steady gains, suitable for beginners',
      settings: {
        portfolioSettings: {
          maxLossPercentage: 15,
          maxActiveSymbols: 3,
          reservePercentage: 15
        },
        riskManagement: {
          stopLossPercentage: 5,
          takeProfitPercentage: 10,
          enableTrailingStop: true,
          trailingStopPercentage: 3
        },
        tradingPeriods: {
          defaultPeriod: 'month',
          periodDays: 30,
          acceptLossAfterPeriod: true,
          acceptLossThreshold: 3
        },
        tradingStyle: {
          dayTrading: { enabled: false },
          swingTrading: {
            enabled: true,
            maxHoldingPeriodDays: 14,
            targetProfitRange: { min: 5, max: 15 }
          }
        }
      }
    },
    balanced: {
      name: 'Balanced Trader ⚖️',
      description: 'Moderate risk and reward, good for most users',
      settings: {
        portfolioSettings: {
          maxLossPercentage: 20,
          maxActiveSymbols: 5,
          reservePercentage: 10
        },
        riskManagement: {
          stopLossPercentage: 8,
          takeProfitPercentage: 15,
          enableTrailingStop: true,
          trailingStopPercentage: 5
        },
        tradingPeriods: {
          defaultPeriod: 'week',
          periodDays: 7,
          acceptLossAfterPeriod: true,
          acceptLossThreshold: 5
        },
        tradingStyle: {
          dayTrading: {
            enabled: true,
            maxHoldingPeriodHours: 24,
            quickProfitTarget: 3
          },
          swingTrading: {
            enabled: true,
            maxHoldingPeriodDays: 7,
            targetProfitRange: { min: 8, max: 25 }
          }
        }
      }
    },
    aggressive: {
      name: 'Aggressive Trader 🚀',
      description: 'High risk, high reward, for experienced traders',
      settings: {
        portfolioSettings: {
          maxLossPercentage: 30,
          maxActiveSymbols: 8,
          reservePercentage: 5
        },
        riskManagement: {
          stopLossPercentage: 12,
          takeProfitPercentage: 25,
          enableTrailingStop: true,
          trailingStopPercentage: 8
        },
        tradingPeriods: {
          defaultPeriod: 'day',
          periodDays: 3,
          acceptLossAfterPeriod: true,
          acceptLossThreshold: 8
        },
        tradingStyle: {
          dayTrading: {
            enabled: true,
            maxHoldingPeriodHours: 12,
            quickProfitTarget: 5
          },
          swingTrading: {
            enabled: true,
            maxHoldingPeriodDays: 3,
            targetProfitRange: { min: 15, max: 50 }
          }
        }
      }
    },
    dayTraderSpecial: {
      name: 'Day Trader Special ⚡',
      description: 'Optimized for day trading with quick entries and exits',
      settings: {
        portfolioSettings: {
          maxLossPercentage: 25,
          maxActiveSymbols: 6,
          reservePercentage: 8
        },
        riskManagement: {
          stopLossPercentage: 6,
          takeProfitPercentage: 12,
          enableTrailingStop: true,
          trailingStopPercentage: 4
        },
        tradingPeriods: {
          defaultPeriod: 'day',
          periodDays: 1,
          acceptLossAfterPeriod: true,
          acceptLossThreshold: 4
        },
        tradingStyle: {
          dayTrading: {
            enabled: true,
            maxHoldingPeriodHours: 8,
            quickProfitTarget: 2
          },
          swingTrading: { enabled: false }
        }
      }
    }
  };

  res.json({
    success: true,
    data: {
      presets,
      message: 'Trading presets retrieved successfully 🐶'
    }
  });
});

// 🎯 Apply a preset configuration
router.post('/presets/:presetName', async (req, res) => {
  try {
    const { presetName } = req.params;
    const { capitalAmount } = req.body;

    // Get presets
    const presetsResponse = await new Promise((resolve) => {
      router.stack.find(layer => layer.route?.path === '/presets' && layer.route.methods.get)
        .route.stack[0].handle({}, { json: resolve }, () => { });
    });

    const presets = presetsResponse.data.presets;
    const preset = presets[presetName];

    if (!preset) {
      return res.status(404).json({
        success: false,
        error: `Preset '${presetName}' not found`
      });
    }

    let config = await EnhancedTradingConfig.findOne({});
    if (!config) {
      config = EnhancedTradingConfig.createOptimizedConfig(capitalAmount || 50);
    }

    // Apply preset settings
    Object.assign(config.portfolioSettings, preset.settings.portfolioSettings);
    Object.assign(config.riskManagement, preset.settings.riskManagement);
    Object.assign(config.tradingPeriods, preset.settings.tradingPeriods);
    Object.assign(config.tradingStyle, preset.settings.tradingStyle);

    // Adjust for capital amount if provided
    if (capitalAmount) {
      config.portfolioSettings.totalCapital = capitalAmount;
      config.positionSizing.minPositionSize = Math.max(capitalAmount * 0.05, 2);
      config.positionSizing.maxPositionSize = Math.min(capitalAmount * 0.3, 50);
    }

    config.lastModified = new Date();
    await config.save();

    res.json({
      success: true,
      data: {
        appliedPreset: preset.name,
        config,
        message: `${preset.name} configuration applied successfully! 🐶`
      }
    });

  } catch (error) {
    logger.error('Apply preset error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to apply preset configuration'
    });
  }
});

// 🐶 Get Bark Trader recommendations based on current performance
router.get('/recommendations', async (req, res) => {
  try {
    // This would typically analyze recent performance data
    // For now, we'll provide general recommendations

    const recommendations = [
      {
        type: 'capital',
        priority: 'high',
        title: 'Optimize Your $50 Capital 💰',
        description: 'With $50, focus on 3-5 tokens max to avoid over-diversification',
        action: 'Reduce active symbols to 3-5 for better position sizing'
      },
      {
        type: 'risk',
        priority: 'medium',
        title: 'Set Realistic Loss Limits 🛡️',
        description: 'With limited capital, a 20% loss ($10) allows for recovery',
        action: 'Keep max loss at 20% of your total capital'
      },
      {
        type: 'timeframe',
        priority: 'medium',
        title: 'One Week Trading Period ⏰',
        description: 'Weekly periods balance day trading and swing trading opportunities',
        action: 'Use 1-week default period with accept loss at 5%'
      },
      {
        type: 'strategy',
        priority: 'low',
        title: 'Enable Both Trading Styles 🎯',
        description: 'Day trading for quick profits, swing trading for larger moves',
        action: 'Enable both day trading (3% target) and swing trading (8-25% target)'
      },
      {
        type: 'positions',
        priority: 'high',
        title: 'Smart Position Sizing 📊',
        description: 'With $50, aim for $8-12 per position to manage risk effectively',
        action: 'Set min position $5, max position $15'
      }
    ];

    res.json({
      success: true,
      data: {
        recommendations,
        message: 'Bark Trader recommendations ready! 🐶 Woof!'
      }
    });

  } catch (error) {
    logger.error('Get recommendations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get recommendations'
    });
  }
});

export default router;