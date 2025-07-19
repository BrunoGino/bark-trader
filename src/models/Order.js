import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    index: true
  },
  orderId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  side: {
    type: String,
    enum: ['BUY', 'SELL'],
    required: true
  },
  type: {
    type: String,
    enum: ['MARKET', 'LIMIT', 'STOP_LIMIT', 'STOP_MARKET'],
    default: 'MARKET'
  },
  quantity: {
    type: Number,
    required: true,
    min: 0
  },
  originalQuantity: {
    type: Number,
    required: true,
    min: 0
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  executedQuantity: {
    type: Number,
    default: 0
  },
  cummulativeQuoteQuantity: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'PENDING_CANCEL', 'REJECTED', 'EXPIRED'],
    default: 'NEW'
  },
  timeInForce: {
    type: String,
    enum: ['GTC', 'IOC', 'FOK'],
    default: 'GTC'
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  updateTime: {
    type: Date,
    default: Date.now
  },
  // Trading specific fields
  pnl: {
    type: Number,
    default: 0
  },
  fees: {
    type: Number,
    default: 0
  },
  buyOrderId: {
    type: String,
    index: true
  },
  sellOrderId: {
    type: String,
    index: true
  },
  // Technical analysis data
  indicators: {
    rsi: Number,
    macd: Number,
    sma20: Number,
    sma50: Number,
    bollinger: {
      upper: Number,
      middle: Number,
      lower: Number
    }
  },
  // Risk management
  stopLoss: {
    type: Number,
    min: 0
  },
  takeProfit: {
    type: Number,
    min: 0
  },
  riskAmount: {
    type: Number,
    default: 0
  },
  // Metadata
  strategy: {
    type: String,
    default: 'default'
  },
  notes: String,
  isTestOrder: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  versionKey: false
});

// Indexes for better query performance
orderSchema.index({ symbol: 1, timestamp: -1 });
orderSchema.index({ status: 1, timestamp: -1 });
orderSchema.index({ side: 1, timestamp: -1 });
orderSchema.index({ timestamp: -1 });
orderSchema.index({ pnl: -1 });

// Compound indexes
orderSchema.index({ symbol: 1, side: 1, status: 1 });
orderSchema.index({ timestamp: -1, symbol: 1 });

// Virtual for calculating unrealized PnL
orderSchema.virtual('unrealizedPnl').get(function() {
  if (this.side === 'BUY' && this.status === 'FILLED') {
    // This would need current market price to calculate
    // Will be calculated in the application logic
    return null;
  }
  return 0;
});

// Methods
orderSchema.methods.calculatePnL = function(sellPrice) {
  if (this.side === 'BUY') {
    return (sellPrice - this.price) * this.quantity;
  }
  return 0;
};

orderSchema.methods.isOpen = function() {
  return ['NEW', 'PARTIALLY_FILLED'].includes(this.status);
};

orderSchema.methods.isClosed = function() {
  return ['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED'].includes(this.status);
};

// Statics
orderSchema.statics.findActiveOrders = function() {
  return this.find({ status: { $in: ['NEW', 'PARTIALLY_FILLED'] } });
};

orderSchema.statics.findBySymbol = function(symbol) {
  return this.find({ symbol }).sort({ timestamp: -1 });
};

orderSchema.statics.findTodaysOrders = function() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  return this.find({
    timestamp: {
      $gte: today,
      $lt: tomorrow
    }
  });
};

orderSchema.statics.calculateDailyPnL = function(date = new Date()) {
  const startDate = new Date(date);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);
  
  return this.aggregate([
    {
      $match: {
        timestamp: { $gte: startDate, $lt: endDate },
        pnl: { $exists: true }
      }
    },
    {
      $group: {
        _id: '$symbol',
        totalPnL: { $sum: '$pnl' },
        trades: { $sum: 1 },
        volume: { $sum: { $multiply: ['$quantity', '$price'] } },
        winningTrades: {
          $sum: { $cond: [{ $gt: ['$pnl', 0] }, 1, 0] }
        },
        losingTrades: {
          $sum: { $cond: [{ $lt: ['$pnl', 0] }, 1, 0] }
        }
      }
    }
  ]);
};

// Pre-save middleware
orderSchema.pre('save', function(next) {
  this.updateTime = new Date();
  next();
});

// Post-save middleware for logging
orderSchema.post('save', function(doc) {
  console.log(`Order saved: ${doc.symbol} ${doc.side} ${doc.quantity} at ${doc.price}`);
});

export const Order = mongoose.model('Order', orderSchema);