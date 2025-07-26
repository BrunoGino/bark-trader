import mongoose from 'mongoose';

const enhancedTradingConfigSchema = new mongoose.Schema({
  // Portfolio Management 🐶
  portfolioSettings: {
    totalCapital: {
      type: Number,
      required: true,
      default: 50, // $50 starting capital
      min: 1
    },
    maxLossPercentage: {
      type: Number,
      default: 20, // 20% max loss of total capital
      min: 1,
      max: 50
    },
    maxActiveSymbols: {
      type: Number,
      default: 5, // Max 5 different tokens
      min: 1,
      max: 20
    },
    maxConcurrentOrders: {
      type: Number,
      default: 15, // Can have more orders if conditions are met
      min: 1,
      max: 50
    },
    reservePercentage: {
      type: Number,
      default: 10, // Keep 10% in reserve for opportunities
      min: 0,
      max: 30
    }
  },

  // Trading Periods & Timeframes
  tradingPeriods: {
    defaultPeriod: {
      type: String,
      enum: ['day', 'week', 'month', 'quarter'],
      default: 'week'
    },
    periodDays: {
      type: Number,
      default: 7, // 1 week default
      min: 1,
      max: 365
    },
    // Accept loss mechanism after period expires
    acceptLossAfterPeriod: {
      type: Boolean,
      default: true
    },
    acceptLossThreshold: {
      type: Number,
      default: 5, // Accept 5% loss after period expires
      min: 1,
      max: 20
    },
    // Grace period before forced accept loss
    gracePeriodHours: {
      type: Number,
      default: 24, // 24 hours grace period
      min: 1,
      max: 168 // Max 1 week
    }
  },

  // Smart Loss Calculation (Real Loss vs Paper Loss)
  lossCalculation: {
    // Only count realized losses (sold at loss)
    onlyRealizedLosses: {
      type: Boolean,
      default: true
    },
    // Consider unrealized losses in risk calculation
    includeUnrealizedInRisk: {
      type: Boolean,
      default: true
    },
    // Percentage of unrealized losses to consider
    unrealizedLossWeight: {
      type: Number,
      default: 0.5, // 50% weight for unrealized losses
      min: 0,
      max: 1
    }
  },

  // Position Sizing Strategy
  positionSizing: {
    strategy: {
      type: String,
      enum: ['equal_weight', 'risk_parity', 'kelly_criterion', 'fixed_amount'],
      default: 'risk_parity'
    },
    // For equal weight: totalCapital / maxActiveSymbols
    // For risk parity: based on volatility
    // For kelly: based on win rate and average win/loss
    minPositionSize: {
      type: Number,
      default: 5, // $5 minimum position
      min: 1
    },
    maxPositionSize: {
      type: Number,
      default: 15, // $15 maximum position (30% of $50)
      min: 1
    },
    // Dynamic position sizing based on performance
    dynamicSizing: {
      type: Boolean,
      default: true
    }
  },

  // Risk Management Rules
  riskManagement: {
    // Stop loss per position
    stopLossPercentage: {
      type: Number,
      default: 8, // 8% stop loss per position
      min: 1,
      max: 20
    },
    // Take profit per position
    takeProfitPercentage: {
      type: Number,
      default: 15, // 15% take profit
      min: 1,
      max: 100
    },
    // Trailing stop
    enableTrailingStop: {
      type: Boolean,
      default: true
    },
    trailingStopPercentage: {
      type: Number,
      default: 5, // 5% trailing stop
      min: 1,
      max: 15
    },
    // Maximum correlation between positions
    maxCorrelation: {
      type: Number,
      default: 0.7, // Don't hold highly correlated assets
      min: 0,
      max: 1
    }
  },

  // Trading Style Configuration
  tradingStyle: {
    dayTrading: {
      enabled: {
        type: Boolean,
        default: true
      },
      maxHoldingPeriodHours: {
        type: Number,
        default: 24, // Max 24 hours for day trades
        min: 1,
        max: 168
      },
      quickProfitTarget: {
        type: Number,
        default: 3, // 3% quick profit for day trades
        min: 0.5,
        max: 10
      }
    },
    swingTrading: {
      enabled: {
        type: Boolean,
        default: true
      },
      maxHoldingPeriodDays: {
        type: Number,
        default: 7, // Max 1 week for swing trades
        min: 1,
        max: 30
      },
      targetProfitRange: {
        min: {
          type: Number,
          default: 8 // 8% minimum target
        },
        max: {
          type: Number,
          default: 25 // 25% maximum target
        }
      }
    }
  },

  // Market Conditions & Filters
  marketConditions: {
    bullMarketThreshold: {
      type: Number,
      default: 5, // 5% market up = bull market
      min: 1,
      max: 20
    },
    bearMarketThreshold: {
      type: Number,
      default: -5, // 5% market down = bear market
      min: -50,
      max: -1
    },
    // Adjust strategy based on market conditions
    adaptToMarket: {
      type: Boolean,
      default: true
    },
    // Reduce risk in bear markets
    bearMarketRiskReduction: {
      type: Number,
      default: 0.5, // 50% risk reduction in bear markets
      min: 0.1,
      max: 1
    }
  },

  // Smart Order Management
  orderManagement: {
    // Allow multiple orders per symbol for different strategies
    allowMultipleOrdersPerSymbol: {
      type: Boolean,
      default: true
    },
    // Maximum orders per symbol
    maxOrdersPerSymbol: {
      type: Number,
      default: 3, // Max 3 orders per symbol (DCA, swing, day trade)
      min: 1,
      max: 10
    },
    // Order execution strategy
    executionStrategy: {
      type: String,
      enum: ['market', 'limit', 'smart'],
      default: 'smart' // Smart routing based on spread and volume
    },
    // Minimum time between orders for same symbol
    orderCooldownMinutes: {
      type: Number,
      default: 15, // 15 minutes cooldown
      min: 1,
      max: 1440
    }
  },

  // Performance Tracking
  performanceTargets: {
    // Weekly targets
    weeklyTargetPercentage: {
      type: Number,
      default: 5, // 5% weekly target
      min: 1,
      max: 50
    },
    // Monthly targets
    monthlyTargetPercentage: {
      type: Number,
      default: 20, // 20% monthly target
      min: 1,
      max: 200
    },
    // Drawdown limits
    maxDrawdownPercentage: {
      type: Number,
      default: 15, // 15% max drawdown
      min: 5,
      max: 50
    },
    // Performance review periods
    reviewPeriodDays: {
      type: Number,
      default: 7, // Review performance weekly
      min: 1,
      max: 30
    }
  },

  // Emergency & Safety Settings
  emergencySettings: {
    // Emergency stop triggers
    totalLossEmergencyStop: {
      type: Number,
      default: 18, // Emergency stop at 18% total loss
      min: 5,
      max: 30
    },
    // Flash crash protection
    flashCrashProtection: {
      type: Boolean,
      default: true
    },
    flashCrashThreshold: {
      type: Number,
      default: -10, // Stop trading if market drops 10% quickly
      min: -50,
      max: -5
    },
    // Pause trading after losses
    pauseAfterConsecutiveLosses: {
      type: Number,
      default: 3, // Pause after 3 consecutive losses
      min: 2,
      max: 10
    },
    pauseDurationMinutes: {
      type: Number,
      default: 60, // 1 hour pause
      min: 15,
      max: 1440
    }
  },

  // Base configuration (keeping compatibility)
  activeSymbols: [{
    type: String,
    required: true
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  lastModified: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  versionKey: false
});

// Virtuals for calculated values
enhancedTradingConfigSchema.virtual('maxTotalLossAmount').get(function () {
  return (this.portfolioSettings.totalCapital * this.portfolioSettings.maxLossPercentage) / 100;
});

enhancedTradingConfigSchema.virtual('reserveAmount').get(function () {
  return (this.portfolioSettings.totalCapital * this.portfolioSettings.reservePercentage) / 100;
});

enhancedTradingConfigSchema.virtual('availableCapital').get(function () {
  return this.portfolioSettings.totalCapital - this.reserveAmount;
});

enhancedTradingConfigSchema.virtual('maxPositionSizeCalculated').get(function () {
  const availableCapital = this.availableCapital;
  const maxSymbols = this.portfolioSettings.maxActiveSymbols;
  return Math.min(
    this.positionSizing.maxPositionSize,
    availableCapital / maxSymbols
  );
});

// Methods for risk calculation
enhancedTradingConfigSchema.methods.calculateRealizedLoss = function (orders) {
  return orders
    .filter(order => order.side === 'SELL' && order.pnl < 0)
    .reduce((total, order) => total + Math.abs(order.pnl), 0);
};

enhancedTradingConfigSchema.methods.calculateUnrealizedLoss = function (activePositions) {
  return activePositions
    .filter(position => position.unrealizedPnl < 0)
    .reduce((total, position) => total + Math.abs(position.unrealizedPnl), 0);
};

enhancedTradingConfigSchema.methods.calculateTotalRisk = function (realizedLoss, unrealizedLoss) {
  const weightedUnrealizedLoss = unrealizedLoss * this.lossCalculation.unrealizedLossWeight;
  return this.lossCalculation.onlyRealizedLosses ?
    realizedLoss :
    realizedLoss + (this.lossCalculation.includeUnrealizedInRisk ? weightedUnrealizedLoss : 0);
};

enhancedTradingConfigSchema.methods.canPlaceNewOrder = function (currentRisk, orderValue, activeOrdersCount) {
  const maxLoss = this.maxTotalLossAmount;
  const riskAfterOrder = currentRisk + (orderValue * this.riskManagement.stopLossPercentage / 100);

  return riskAfterOrder <= maxLoss &&
    activeOrdersCount < this.portfolioSettings.maxConcurrentOrders;
};

enhancedTradingConfigSchema.methods.shouldAcceptLoss = function (position, currentTime) {
  const positionAge = currentTime - position.entryTime;
  const periodMs = this.tradingPeriods.periodDays * 24 * 60 * 60 * 1000;
  const gracePeriodMs = this.tradingPeriods.gracePeriodHours * 60 * 60 * 1000;

  if (!this.tradingPeriods.acceptLossAfterPeriod) return false;

  const isExpired = positionAge > periodMs;
  const isInGracePeriod = positionAge <= (periodMs + gracePeriodMs);
  const lossExceedsThreshold = Math.abs(position.unrealizedPnl / position.value) >
    (this.tradingPeriods.acceptLossThreshold / 100);

  return isExpired && (!isInGracePeriod || lossExceedsThreshold);
};

enhancedTradingConfigSchema.methods.calculateOptimalPositionSize = function (symbol, volatility, winRate) {
  const availableCapital = this.availableCapital;
  const strategy = this.positionSizing.strategy;

  switch (strategy) {
    case 'equal_weight':
      return availableCapital / this.portfolioSettings.maxActiveSymbols;

    case 'risk_parity':
      // Inverse volatility weighting
      const avgVolatility = 0.15; // Assume 15% average crypto volatility
      const volAdjustment = avgVolatility / Math.max(volatility, 0.05);
      return Math.min(
        (availableCapital / this.portfolioSettings.maxActiveSymbols) * volAdjustment,
        this.positionSizing.maxPositionSize
      );

    case 'kelly_criterion':
      // Kelly formula: f = (bp - q) / b
      // where b = odds, p = win probability, q = lose probability
      if (!winRate || winRate <= 0.5) return this.positionSizing.minPositionSize;

      const avgWin = 0.1; // Assume 10% average win
      const avgLoss = 0.08; // Assume 8% average loss
      const kellyFraction = ((avgWin * winRate) - (1 - winRate)) / avgWin;

      return Math.min(
        Math.max(availableCapital * kellyFraction, this.positionSizing.minPositionSize),
        this.positionSizing.maxPositionSize
      );

    case 'fixed_amount':
    default:
      return this.positionSizing.minPositionSize;
  }
};

// Static methods
enhancedTradingConfigSchema.statics.createOptimizedConfig = function (userCapital = 50) {
  return new this({
    portfolioSettings: {
      totalCapital: userCapital,
      maxLossPercentage: 20,
      maxActiveSymbols: 5,
      maxConcurrentOrders: Math.floor(userCapital / 3), // Roughly $3 per order
      reservePercentage: 10
    },
    activeSymbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'DOGEUSDT'],
    positionSizing: {
      minPositionSize: Math.max(userCapital * 0.05, 2), // 5% of capital or $2 min
      maxPositionSize: Math.min(userCapital * 0.3, 15)   // 30% of capital or $15 max
    }
  });
};

export const EnhancedTradingConfig = mongoose.model('EnhancedTradingConfig', enhancedTradingConfigSchema);