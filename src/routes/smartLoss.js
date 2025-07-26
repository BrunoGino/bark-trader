// Smart Loss Management API Routes for Bark Trader 🐶
import express from 'express';
import { tradingBot } from '../index.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// 🧠 Get smart recommendations for current portfolio
router.get('/smart-recommendations', async (req, res) => {
  try {
    if (!tradingBot?.smartLossManager) {
      return res.status(503).json({
        success: false,
        error: 'Smart Loss Manager not initialized'
      });
    }

    const recommendations = await tradingBot.getSmartRecommendations();

    res.json({
      success: true,
      data: {
        ...recommendations,
        message: '🐶 Bark Trader smart analysis complete! Woof!'
      }
    });

  } catch (error) {
    logger.error('Get smart recommendations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get smart recommendations'
    });
  }
});

// 📊 Analyze specific position for smart selling decision
router.post('/analyze-position', async (req, res) => {
  try {
    const { symbol, orderId } = req.body;

    if (!symbol || !orderId) {
      return res.status(400).json({
        success: false,
        error: 'Symbol and orderId are required'
      });
    }

    if (!tradingBot?.smartLossManager) {
      return res.status(503).json({
        success: false,
        error: 'Smart Loss Manager not initialized'
      });
    }

    // Find the position
    const positions = tradingBot.getPositionsForSymbol(symbol);
    const position = positions.find(p => p.orderId === orderId);

    if (!position) {
      return res.status(404).json({
        success: false,
        error: 'Position not found'
      });
    }

    const currentPrice = tradingBot.priceCache.get(symbol);
    if (!currentPrice) {
      return res.status(400).json({
        success: false,
        error: 'Current price not available for symbol'
      });
    }

    const analysis = await tradingBot.smartLossManager.shouldSellPosition(symbol, position, currentPrice);
    const recommendation = await tradingBot.smartLossManager.getPositionRecommendation(symbol, position);

    // Calculate additional metrics
    const unrealizedPnl = (currentPrice - position.entryPrice) * position.quantity;
    const pnlPercentage = (unrealizedPnl / (position.entryPrice * position.quantity)) * 100;
    const holdingTime = Date.now() - position.entryTime;
    const holdingDays = holdingTime / (24 * 60 * 60 * 1000);

    res.json({
      success: true,
      data: {
        position: {
          symbol,
          orderId,
          entryPrice: position.entryPrice,
          currentPrice,
          quantity: position.quantity,
          strategy: position.strategy,
          holdingDays: holdingDays.toFixed(2)
        },
        financials: {
          unrealizedPnl: unrealizedPnl.toFixed(2),
          pnlPercentage: pnlPercentage.toFixed(2),
          positionValue: (position.entryPrice * position.quantity).toFixed(2),
          currentValue: (currentPrice * position.quantity).toFixed(2)
        },
        analysis,
        recommendation,
        smartInsights: {
          trendStatus: analysis.trendSell?.details || [],
          emergencySignals: analysis.emergencySell?.details || [],
          riskLevel: analysis.emergencySell?.confidence > 0.7 ? 'HIGH' :
            analysis.trendSell?.confidence > 0.6 ? 'MEDIUM' : 'LOW'
        },
        message: `🐶 Position analysis complete for ${symbol}!`
      }
    });

  } catch (error) {
    logger.error('Analyze position error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze position'
    });
  }
});

// 🚨 Force smart sell for a specific position
router.post('/force-smart-sell', async (req, res) => {
  try {
    const { symbol, orderId, reason } = req.body;

    if (!symbol || !orderId) {
      return res.status(400).json({
        success: false,
        error: 'Symbol and orderId are required'
      });
    }

    if (!tradingBot?.smartLossManager) {
      return res.status(503).json({
        success: false,
        error: 'Smart Loss Manager not initialized'
      });
    }

    // Find the position
    const positions = tradingBot.getPositionsForSymbol(symbol);
    const position = positions.find(p => p.orderId === orderId);

    if (!position) {
      return res.status(404).json({
        success: false,
        error: 'Position not found'
      });
    }

    // Create manual recommendation
    const manualRecommendation = {
      action: 'SELL',
      reason: reason || 'MANUAL_OVERRIDE',
      confidence: 1.0,
      urgency: 'MEDIUM',
      details: ['Manual sell requested via API']
    };

    await tradingBot.executeSmartSell(symbol, position, manualRecommendation);

    res.json({
      success: true,
      data: {
        message: `🐶 Manual smart sell executed for ${symbol}!`,
        symbol,
        orderId,
        reason: manualRecommendation.reason
      }
    });

  } catch (error) {
    logger.error('Force smart sell error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute smart sell'
    });
  }
});

// 📈 Get portfolio health and risk analysis
router.get('/portfolio-health', async (req, res) => {
  try {
    if (!tradingBot) {
      return res.status(503).json({
        success: false,
        error: 'Trading bot not initialized'
      });
    }

    const health = tradingBot.calculatePortfolioHealth();
    const riskMetrics = tradingBot.riskMetrics;
    const performanceMetrics = tradingBot.performanceMetrics;

    // Calculate additional insights
    const totalCapital = tradingBot.config.portfolioSettings.totalCapital;
    const maxLoss = tradingBot.config.maxTotalLossAmount;
    const currentRiskExposure = riskMetrics.realizedLoss + (riskMetrics.unrealizedLoss * 0.5);

    const insights = {
      capitalPreservation: {
        originalCapital: totalCapital,
        currentRisk: currentRiskExposure,
        remainingRiskBudget: Math.max(0, maxLoss - currentRiskExposure),
        riskUtilization: (currentRiskExposure / maxLoss) * 100
      },
      smartSellEffectiveness: {
        totalSmartSells: performanceMetrics.smartSells?.total || 0,
        preventedLargerLosses: performanceMetrics.smartSells?.prevented_larger_losses || 0,
        effectivenessRate: performanceMetrics.smartSells?.total > 0 ?
          (performanceMetrics.smartSells.prevented_larger_losses / performanceMetrics.smartSells.total * 100) : 0
      },
      tradingVelocity: {
        totalTrades: performanceMetrics.totalTrades,
        averageHoldingTime: 'N/A', // Would need to calculate from historical data
        tradesPerDay: 'N/A' // Would need to calculate based on trading period
      },
      riskDistribution: await calculateRiskDistribution()
    };

    res.json({
      success: true,
      data: {
        portfolioHealth: health,
        riskMetrics,
        performanceMetrics,
        insights,
        recommendations: tradingBot.currentRecommendations || [],
        lastUpdate: new Date().toISOString(),
        message: `🐶 Portfolio health: ${health.score.toFixed(1)}/100 - ${getHealthMessage(health.score)}`
      }
    });

  } catch (error) {
    logger.error('Get portfolio health error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get portfolio health'
    });
  }
});

// 🎛️ Update smart loss settings
router.put('/smart-loss-settings', async (req, res) => {
  try {
    const {
      emergencyThreshold,
      trendReversalThreshold,
      flashCrashThreshold,
      enableTrendSelling,
      enableEmergencySelling
    } = req.body;

    if (!tradingBot?.config) {
      return res.status(503).json({
        success: false,
        error: 'Trading bot not initialized'
      });
    }

    // Update smart loss settings in configuration
    if (!tradingBot.config.smartLossSettings) {
      tradingBot.config.smartLossSettings = {};
    }

    if (emergencyThreshold !== undefined) {
      tradingBot.config.smartLossSettings.emergencyThreshold = Math.max(0.5, Math.min(1.0, emergencyThreshold));
    }

    if (trendReversalThreshold !== undefined) {
      tradingBot.config.smartLossSettings.trendReversalThreshold = Math.max(0.4, Math.min(0.9, trendReversalThreshold));
    }

    if (flashCrashThreshold !== undefined) {
      tradingBot.config.smartLossSettings.flashCrashThreshold = Math.max(-20, Math.min(-5, flashCrashThreshold));
    }

    if (enableTrendSelling !== undefined) {
      tradingBot.config.smartLossSettings.enableTrendSelling = Boolean(enableTrendSelling);
    }

    if (enableEmergencySelling !== undefined) {
      tradingBot.config.smartLossSettings.enableEmergencySelling = Boolean(enableEmergencySelling);
    }

    await tradingBot.config.save();

    res.json({
      success: true,
      data: {
        smartLossSettings: tradingBot.config.smartLossSettings,
        message: '🐶 Smart loss settings updated! Bark Trader is now smarter!'
      }
    });

  } catch (error) {
    logger.error('Update smart loss settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update smart loss settings'
    });
  }
});

// 📊 Get trend analysis for all active symbols
router.get('/trend-analysis', async (req, res) => {
  try {
    if (!tradingBot?.smartLossManager) {
      return res.status(503).json({
        success: false,
        error: 'Smart Loss Manager not initialized'
      });
    }

    const trendAnalysis = {};

    for (const symbol of tradingBot.config.activeSymbols) {
      try {
        const klines = await tradingBot.binance.candlesticks(symbol, '15m', false, { limit: 100 });
        const trend = await tradingBot.smartLossManager.analyzeTrend(symbol, klines);
        const indicators = calculateTechnicalIndicators(klines);
        const momentum = await tradingBot.smartLossManager.analyzeMomentum(symbol, indicators);

        trendAnalysis[symbol] = {
          trend,
          momentum,
          currentPrice: tradingBot.priceCache.get(symbol),
          technicalIndicators: {
            rsi: indicators.rsi.toFixed(2),
            macd: {
              macd: indicators.macd.macd.toFixed(4),
              signal: indicators.macd.signal.toFixed(4),
              histogram: indicators.macd.histogram.toFixed(4)
            },
            bollinger: {
              upper: indicators.bollinger.upper.toFixed(2),
              middle: indicators.bollinger.middle.toFixed(2),
              lower: indicators.bollinger.lower.toFixed(2)
            }
          },
          recommendation: trend.direction === 'DOWN' || trend.direction === 'STRONG_DOWN' ?
            'AVOID_NEW_POSITIONS' :
            trend.direction === 'UP' || trend.direction === 'STRONG_UP' ?
              'FAVORABLE_FOR_ENTRY' : 'NEUTRAL'
        };
      } catch (error) {
        logger.error(`Failed to analyze trend for ${symbol}:`, error.message);
        trendAnalysis[symbol] = { error: 'Analysis failed' };
      }
    }

    res.json({
      success: true,
      data: {
        trendAnalysis,
        marketOverview: calculateMarketOverview(trendAnalysis),
        timestamp: new Date().toISOString(),
        message: '🐶 Trend analysis complete for all symbols!'
      }
    });

  } catch (error) {
    logger.error('Get trend analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get trend analysis'
    });
  }
});

// Helper functions
async function calculateRiskDistribution() {
  if (!tradingBot?.activePositions) return {};

  const distribution = {};

  for (const [symbol, positions] of tradingBot.activePositions.entries()) {
    const currentPrice = tradingBot.priceCache.get(symbol);
    if (!currentPrice) continue;

    let symbolRisk = 0;
    for (const position of positions) {
      const positionValue = position.entryPrice * position.quantity;
      const potentialLoss = positionValue * (tradingBot.config.riskManagement.stopLossPercentage / 100);
      symbolRisk += potentialLoss;
    }

    distribution[symbol] = {
      positions: positions.length,
      totalRisk: symbolRisk.toFixed(2),
      riskPercentage: ((symbolRisk / tradingBot.config.maxTotalLossAmount) * 100).toFixed(1)
    };
  }

  return distribution;
}

function getHealthMessage(score) {
  if (score >= 90) return 'Excellent! 🐕';
  if (score >= 80) return 'Very Good! 🐶';
  if (score >= 70) return 'Good 👍';
  if (score >= 60) return 'Fair ⚖️';
  if (score >= 50) return 'Needs Attention ⚠️';
  return 'Critical - Review Required! 🚨';
}

function calculateMarketOverview(trendAnalysis) {
  const symbols = Object.keys(trendAnalysis);
  let bullish = 0, bearish = 0, neutral = 0;

  symbols.forEach(symbol => {
    const analysis = trendAnalysis[symbol];
    if (analysis.trend) {
      if (analysis.trend.direction === 'UP' || analysis.trend.direction === 'STRONG_UP') {
        bullish++;
      } else if (analysis.trend.direction === 'DOWN' || analysis.trend.direction === 'STRONG_DOWN') {
        bearish++;
      } else {
        neutral++;
      }
    }
  });

  const total = symbols.length;
  return {
    bullishPercentage: total > 0 ? ((bullish / total) * 100).toFixed(1) : 0,
    bearishPercentage: total > 0 ? ((bearish / total) * 100).toFixed(1) : 0,
    neutralPercentage: total > 0 ? ((neutral / total) * 100).toFixed(1) : 0,
    overallSentiment: bullish > bearish ? 'BULLISH' : bearish > bullish ? 'BEARISH' : 'NEUTRAL',
    recommendation: bullish > bearish ?
      '🚀 Market looks favorable for new positions' :
      bearish > bullish ?
        '🛡️ Market showing weakness, be cautious' :
        '⚖️ Mixed signals, use standard risk management'
  };
}

export default router;