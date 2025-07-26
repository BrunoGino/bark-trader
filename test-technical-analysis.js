// Test file for debugging technical analysis
import { calculateTechnicalIndicators } from './src/utils/technicalAnalysis.js';
import { logger } from './src/utils/logger.js';

// Sample candlestick data for testing
const sampleKlines = [
  ["1640995200000", "50000", "50500", "49800", "50200", "100"],
  ["1640995260000", "50200", "50600", "49900", "50300", "110"],
  ["1640995320000", "50300", "50700", "50000", "50400", "105"],
  ["1640995380000", "50400", "50800", "50100", "50500", "120"],
  ["1640995440000", "50500", "50900", "50200", "50600", "115"],
];

async function testTechnicalAnalysis() {
  try {
    logger.info('🧪 Testing Technical Analysis...');
    
    // Set a breakpoint on the next line to test debugging
    const indicators = calculateTechnicalIndicators(sampleKlines);
    
    console.log('Technical Indicators:', {
      currentPrice: indicators.currentPrice,
      rsi: indicators.rsi,
      sma20: indicators.sma20,
      sma50: indicators.sma50,
      macd: indicators.macd,
      bollinger: indicators.bollinger
    });
    
    logger.info('✅ Technical analysis test completed');
    
  } catch (error) {
    logger.error('❌ Technical analysis test failed:', error);
  }
}

// Run the test
testTechnicalAnalysis();