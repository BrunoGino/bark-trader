import mongoose from 'mongoose';

const tradingConfigSchema = new mongoose.Schema({
  // Active trading symbols
  activeSymbols: [{
    type: String,
    required: true
  }],

  // Trading limits
  maxConcurrentTrades: {
    type: Number,
    default: 5,
    min: 1,
    max: 20
  },

  maxLossPerTrade: {
    type: Number,
    default: 10,
    min: 1,
    max: 1000
  },

  maxTotalLoss: {
    type: Number,
    default: 50,
    min: 1,
    max: 10000
  },

  // Trading window and timing
  tradingWindowMinutes: {
    type: Number,
    default: 15,
    min: 1,
    max: 1440 // 24 hours
  },

  // Profit targets
  maxDailyGainPercent: {
    type: Number,
    default: 3,
    min: 0.1,
    max: 50
  },

  minGainPercent: {
    type: Number,
    default: 1,
    min: 0.1,
    max: 20
  },

  // Risk management
  stopLossPercent: {
    type: Number,
    default: 2,
    min: 0.1,
    max: 10
  },

  takeProfitPercent: {
    type: Number,
    default: 3,
    min: 0.1,
    max: 50
  },

  // Position sizing
  riskPercentPerTrade: {
    type: Number,
    default: 2, // 2% of portfolio per trade
    min: 0.1,
    max: 10
  },

  baseOrderSize: {
    type: Number,
    default: 10, // $10 per trade
    min: 1,
    max: 1000
  },

  // Technical analysis settings
  technicalSettings: {
    rsiPeriod: {
      type: Number,
      default: 14,
      min: 5,
      max: 50
    },
    rsiBuyThreshold: {
      type: Number,
      default: 30,
      min: 10,
      max: 50
    },
    rsiSellThreshold: {
      type: Number,
      default: 70,
      min: 50,
      max: 90
    },
    macdFastPeriod: {
      type: Number,
      default: 12,
      min: 5,
      max: 50
    },
    macdSlowPeriod: {
      type: Number,
      default: 26,
      min: 10,
      max: 100
    },
    macdSignalPeriod: {
      type: Number,
      default: 9,
      min: 5,
      max: 50
    },
    smaShortPeriod: {
      type: Number,
      default: 20,
      min: 5,
      max: 100
    },
    smaLongPeriod: {
      type: Number,
      default: 50,
      min: 20,
      max: 200
    }
  },

  // Trading strategy settings
  strategySettings: {
    strategy: {
      type: String,
      enum: ['rsi_sma', 'macd', 'bollinger', 'momentum', 'mean_reversion'],
      default: 'rsi_sma'
    },
    enableStopLoss: {
      type: Boolean,
      default: true
    },
    enableTakeProfit: {
      type: Boolean,
      default: true
    },
    enableTrailingStop: {
      type: Boolean,
      default: false
    },
    trailingStopPercent: {
      type: Number,
      default: 1,
      min: 0.1,
      max: 5
    }
  },

  // Market conditions filters
  marketFilters: {
    minVolume24h: {
      type: Number,
      default: 100000 // $100k minimum 24h volume
    },
    maxVolatility: {
      type: Number,
      default: 10 // 10% max daily volatility
    },
    blacklistSymbols: [{
      type: String
    }]
  },

  // Time-based restrictions
  timeRestrictions: {
    tradingHours: {
      start: {
        type: String,
        default: '00:00'
      },
      end: {
        type: String,
        default: '23:59'
      }
    },
    timezone: {
      type: String,
      default: 'UTC'
    },
    pauseDuringNews: {
      type: Boolean,
      default: false
    }
  },

  // System settings
  isActive: {
    type: Boolean,
    default: true
  },

  testMode: {
    type: Boolean,
    default: true
  },

  enableWebhooks: {
    type: Boolean,
    default: false
  },

  webhookUrl: {
    type: String
  },

  // Logging and monitoring
  logLevel: {
    type: String,
    enum: ['error', 'warn', 'info', 'debug'],
    default: 'info'
  },

  enableDetailedLogging: {
    type: Boolean,
    default: false
  },

  // Metadata
  version: {
    type: String,
    default: '1.0.0'
  },

  description: {
    type: String,
    default: 'Default trading configuration'
  },

  lastModified: {
    type: Date,
    default: Date.now
  },

  modifiedBy: {
    type: String,
    default: 'system'
  }
}, {
  timestamps: true,
  versionKey: false
});

// Indexes
tradingConfigSchema.index({ isActive: 1 });
tradingConfigSchema.index({ lastModified: -1 });

// Virtuals
tradingConfigSchema.virtual('totalSymbols').get(function () {
  return this.activeSymbols.length;
});

tradingConfigSchema.virtual('maxDailyRisk').get(function () {
  return this.maxLossPerTrade * this.maxConcurrentTrades;
});

// Methods
tradingConfigSchema.methods.isSymbolActive = function (symbol) {
  return this.activeSymbols.includes(symbol);
};

tradingConfigSchema.methods.addSymbol = function (symbol) {
  if (!this.activeSymbols.includes(symbol)) {
    this.activeSymbols.push(symbol);
  }
  return this;
};

tradingConfigSchema.methods.removeSymbol = function (symbol) {
  this.activeSymbols = this.activeSymbols.filter(s => s !== symbol);
  return this;
};

tradingConfigSchema.methods.canTrade = function () {
  return this.isActive && this.activeSymbols.length > 0;
};

tradingConfigSchema.methods.validateSettings = function () {
  const errors = [];

  if (this.minGainPercent >= this.maxDailyGainPercent) {
    errors.push('Minimum gain must be less than maximum daily gain');
  }

  if (this.maxLossPerTrade >= this.maxTotalLoss) {
    errors.push('Max loss per trade must be less than max total loss');
  }

  if (this.technicalSettings.smaShortPeriod >= this.technicalSettings.smaLongPeriod) {
    errors.push('Short SMA period must be less than long SMA period');
  }

  if (this.activeSymbols.length > this.maxConcurrentTrades) {
    errors.push('Number of active symbols exceeds max concurrent trades');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

// Statics
tradingConfigSchema.statics.getActiveConfig = function () {
  return this.findOne({ isActive: true });
};

tradingConfigSchema.statics.createDefault = function () {
  return new this({
    activeSymbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'DOGEUSDT'],
    description: 'Default cryptocurrency trading configuration'
  });
};

// Pre-save middleware
tradingConfigSchema.pre('save', function (next) {
  this.lastModified = new Date();

  // Validate configuration
  const validation = this.validateSettings();
  if (!validation.isValid) {
    const error = new Error('Configuration validation failed');
    error.details = validation.errors;
    return next(error);
  }

  next();
});

// Pre-validate middleware
tradingConfigSchema.pre('validate', function (next) {
  // Ensure unique symbols
  this.activeSymbols = [...new Set(this.activeSymbols)];

  // Convert symbols to uppercase
  this.activeSymbols = this.activeSymbols.map(symbol => symbol.toUpperCase());

  next();
});

export const TradingConfig = mongoose.model('TradingConfig', tradingConfigSchema);