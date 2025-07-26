// Technical Analysis Utilities
export function calculateTechnicalIndicators(klines) {
  const prices = klines.map(k => parseFloat(k[4])); // Close prices
  const highs = klines.map(k => parseFloat(k[2])); // High prices
  const lows = klines.map(k => parseFloat(k[3])); // Low prices
  const volumes = klines.map(k => parseFloat(k[5])); // Volumes

  const currentPrice = prices[prices.length - 1];

  return {
    currentPrice,
    rsi: calculateRSI(prices, 14),
    sma20: calculateSMA(prices, 20),
    sma50: calculateSMA(prices, 50),
    ema12: calculateEMA(prices, 12),
    ema26: calculateEMA(prices, 26),
    macd: calculateMACD(prices),
    bollinger: calculateBollingerBands(prices, 20, 2),
    stochastic: calculateStochastic(highs, lows, prices, 14),
    williams: calculateWilliamsR(highs, lows, prices, 14),
    atr: calculateATR(highs, lows, prices, 14),
    volume: volumes[volumes.length - 1],
    volumeMA: calculateSMA(volumes, 20)
  };
}

// Relative Strength Index
export function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;

  const gains = [];
  const losses = [];

  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  const avgGain = calculateSMA(gains.slice(-period), period);
  const avgLoss = calculateSMA(losses.slice(-period), period);

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// Simple Moving Average
export function calculateSMA(values, period) {
  if (values.length < period) return values[values.length - 1] || 0;
  
  const slice = values.slice(-period);
  return slice.reduce((sum, val) => sum + val, 0) / period;
}

// Exponential Moving Average
export function calculateEMA(values, period) {
  if (values.length < period) return values[values.length - 1] || 0;

  const k = 2 / (period + 1);
  let ema = values[0];

  for (let i = 1; i < values.length; i++) {
    ema = (values[i] * k) + (ema * (1 - k));
  }

  return ema;
}

// MACD (Moving Average Convergence Divergence)
export function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (prices.length < slowPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  const emaFast = calculateEMA(prices, fastPeriod);
  const emaSlow = calculateEMA(prices, slowPeriod);
  const macdLine = emaFast - emaSlow;

  // For signal line, we need MACD values over time
  const macdValues = [];
  for (let i = slowPeriod; i <= prices.length; i++) {
    const slice = prices.slice(0, i);
    const fast = calculateEMA(slice, fastPeriod);
    const slow = calculateEMA(slice, slowPeriod);
    macdValues.push(fast - slow);
  }

  const signal = calculateEMA(macdValues, signalPeriod);
  const histogram = macdLine - signal;

  return {
    macd: macdLine,
    signal: signal,
    histogram: histogram
  };
}

// Bollinger Bands
export function calculateBollingerBands(prices, period = 20, stdDev = 2) {
  if (prices.length < period) {
    const currentPrice = prices[prices.length - 1] || 0;
    return {
      upper: currentPrice,
      middle: currentPrice,
      lower: currentPrice
    };
  }

  const sma = calculateSMA(prices, period);
  const slice = prices.slice(-period);
  
  // Calculate standard deviation
  const variance = slice.reduce((sum, price) => {
    return sum + Math.pow(price - sma, 2);
  }, 0) / period;
  
  const standardDeviation = Math.sqrt(variance);
  
  return {
    upper: sma + (standardDeviation * stdDev),
    middle: sma,
    lower: sma - (standardDeviation * stdDev)
  };
}

// Stochastic Oscillator
export function calculateStochastic(highs, lows, closes, period = 14) {
  if (highs.length < period) return { k: 50, d: 50 };

  const recentHighs = highs.slice(-period);
  const recentLows = lows.slice(-period);
  const currentClose = closes[closes.length - 1];

  const highestHigh = Math.max(...recentHighs);
  const lowestLow = Math.min(...recentLows);

  const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
  
  // Calculate %D (3-period SMA of %K)
  const kValues = [];
  for (let i = period - 1; i < highs.length; i++) {
    const sliceHighs = highs.slice(i - period + 1, i + 1);
    const sliceLows = lows.slice(i - period + 1, i + 1);
    const sliceClose = closes[i];
    
    const hh = Math.max(...sliceHighs);
    const ll = Math.min(...sliceLows);
    
    kValues.push(((sliceClose - ll) / (hh - ll)) * 100);
  }

  const d = calculateSMA(kValues.slice(-3), 3);

  return { k: k || 50, d: d || 50 };
}

// Williams %R
export function calculateWilliamsR(highs, lows, closes, period = 14) {
  if (highs.length < period) return -50;

  const recentHighs = highs.slice(-period);
  const recentLows = lows.slice(-period);
  const currentClose = closes[closes.length - 1];

  const highestHigh = Math.max(...recentHighs);
  const lowestLow = Math.min(...recentLows);

  return ((highestHigh - currentClose) / (highestHigh - lowestLow)) * -100;
}

// Average True Range
export function calculateATR(highs, lows, closes, period = 14) {
  if (highs.length < 2) return 0;

  const trueRanges = [];
  
  for (let i = 1; i < highs.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];
    
    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    
    trueRanges.push(Math.max(tr1, tr2, tr3));
  }

  return calculateSMA(trueRanges, Math.min(period, trueRanges.length));
}

// Money Flow Index
export function calculateMFI(highs, lows, closes, volumes, period = 14) {
  if (highs.length < period + 1) return 50;

  const typicalPrices = [];
  const moneyFlows = [];

  for (let i = 0; i < highs.length; i++) {
    const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
    typicalPrices.push(typicalPrice);
    
    if (i > 0) {
      const moneyFlow = typicalPrice * volumes[i];
      moneyFlows.push(moneyFlow);
    }
  }

  let positiveFlow = 0;
  let negativeFlow = 0;

  for (let i = Math.max(0, typicalPrices.length - period - 1); i < typicalPrices.length - 1; i++) {
    if (typicalPrices[i + 1] > typicalPrices[i]) {
      positiveFlow += moneyFlows[i];
    } else {
      negativeFlow += moneyFlows[i];
    }
  }

  if (negativeFlow === 0) return 100;
  
  const moneyFlowRatio = positiveFlow / negativeFlow;
  return 100 - (100 / (1 + moneyFlowRatio));
}

// Commodity Channel Index
export function calculateCCI(highs, lows, closes, period = 20) {
  if (highs.length < period) return 0;

  const typicalPrices = [];
  for (let i = 0; i < highs.length; i++) {
    typicalPrices.push((highs[i] + lows[i] + closes[i]) / 3);
  }

  const smaTP = calculateSMA(typicalPrices, period);
  const recentTP = typicalPrices.slice(-period);
  
  // Mean deviation
  const meanDeviation = recentTP.reduce((sum, tp) => {
    return sum + Math.abs(tp - smaTP);
  }, 0) / period;

  const currentTP = typicalPrices[typicalPrices.length - 1];
  
  if (meanDeviation === 0) return 0;
  
  return (currentTP - smaTP) / (0.015 * meanDeviation);
}

// Price analysis helpers
export function identifySupport(prices, window = 10) {
  if (prices.length < window * 2) return null;

  const recentPrices = prices.slice(-window * 2);
  const lows = [];

  for (let i = window; i < recentPrices.length - window; i++) {
    const slice = recentPrices.slice(i - window, i + window + 1);
    const minPrice = Math.min(...slice);
    
    if (recentPrices[i] === minPrice) {
      lows.push(recentPrices[i]);
    }
  }

  return lows.length > 0 ? Math.max(...lows) : null;
}

export function identifyResistance(prices, window = 10) {
  if (prices.length < window * 2) return null;

  const recentPrices = prices.slice(-window * 2);
  const highs = [];

  for (let i = window; i < recentPrices.length - window; i++) {
    const slice = recentPrices.slice(i - window, i + window + 1);
    const maxPrice = Math.max(...slice);
    
    if (recentPrices[i] === maxPrice) {
      highs.push(recentPrices[i]);
    }
  }

  return highs.length > 0 ? Math.min(...highs) : null;
}

// Trend analysis
export function identifyTrend(prices, shortPeriod = 20, longPeriod = 50) {
  if (prices.length < longPeriod) return 'SIDEWAYS';

  const shortSMA = calculateSMA(prices, shortPeriod);
  const longSMA = calculateSMA(prices, longPeriod);
  const currentPrice = prices[prices.length - 1];

  if (shortSMA > longSMA && currentPrice > shortSMA) {
    return 'UPTREND';
  } else if (shortSMA < longSMA && currentPrice < shortSMA) {
    return 'DOWNTREND';
  } else {
    return 'SIDEWAYS';
  }
}

// Volume analysis
export function analyzeVolume(volumes, prices, period = 20) {
  if (volumes.length < period) return { signal: 'NEUTRAL', strength: 0 };

  const avgVolume = calculateSMA(volumes, period);
  const currentVolume = volumes[volumes.length - 1];
  const volumeRatio = currentVolume / avgVolume;

  const priceChange = prices.length >= 2 ? 
    ((prices[prices.length - 1] - prices[prices.length - 2]) / prices[prices.length - 2]) * 100 : 0;

  let signal = 'NEUTRAL';
  let strength = 0;

  if (volumeRatio > 1.5) {
    if (priceChange > 0) {
      signal = 'BULLISH';
      strength = Math.min(volumeRatio * priceChange, 100);
    } else if (priceChange < 0) {
      signal = 'BEARISH';
      strength = Math.min(volumeRatio * Math.abs(priceChange), 100);
    }
  }

  return { signal, strength, volumeRatio };
}

// Generate trading signals
export function generateTradingSignals(indicators) {
  const signals = {
    buy: [],
    sell: [],
    score: 0
  };

  const { rsi, macd, bollinger, stochastic, currentPrice, sma20, sma50 } = indicators;

  // RSI signals
  if (rsi < 30) {
    signals.buy.push('RSI_OVERSOLD');
    signals.score += 2;
  } else if (rsi > 70) {
    signals.sell.push('RSI_OVERBOUGHT');
    signals.score -= 2;
  }

  // MACD signals
  if (macd.macd > macd.signal && macd.histogram > 0) {
    signals.buy.push('MACD_BULLISH');
    signals.score += 1;
  } else if (macd.macd < macd.signal && macd.histogram < 0) {
    signals.sell.push('MACD_BEARISH');
    signals.score -= 1;
  }

  // Bollinger Bands signals
  if (currentPrice < bollinger.lower) {
    signals.buy.push('BB_OVERSOLD');
    signals.score += 1;
  } else if (currentPrice > bollinger.upper) {
    signals.sell.push('BB_OVERBOUGHT');
    signals.score -= 1;
  }

  // Moving Average signals
  if (currentPrice > sma20 && sma20 > sma50) {
    signals.buy.push('MA_UPTREND');
    signals.score += 1;
  } else if (currentPrice < sma20 && sma20 < sma50) {
    signals.sell.push('MA_DOWNTREND');
    signals.score -= 1;
  }

  // Stochastic signals
  if (stochastic.k < 20 && stochastic.d < 20) {
    signals.buy.push('STOCH_OVERSOLD');
    signals.score += 1;
  } else if (stochastic.k > 80 && stochastic.d > 80) {
    signals.sell.push('STOCH_OVERBOUGHT');
    signals.score -= 1;
  }

  return signals;
}