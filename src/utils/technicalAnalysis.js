export function calculateTechnicalIndicators(klines) {
  const closes = klines.map(k => parseFloat(k[4])); // Closing prices

  const rsi = calculateRSI(closes, 14);
  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, 50);
  const currentPrice = closes[closes.length - 1];

  return { rsi, sma20, sma50, currentPrice };
}

function calculateSMA(values, period) {
  if (values.length < period) return 0;

  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

function calculateRSI(values, period) {
  if (values.length <= period) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = values.length - period; i < values.length - 1; i++) {
    const diff = values[i + 1] - values[i];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}
