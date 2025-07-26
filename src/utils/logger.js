import winston from 'winston';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Define log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// Define log colors
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue'
};

winston.addColors(logColors);

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let logMessage = `${timestamp} [${level}]: ${message}`;
    
    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      logMessage += `\n${JSON.stringify(meta, null, 2)}`;
    }
    
    return logMessage;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels: logLevels,
  format: fileFormat,
  defaultMeta: { 
    service: 'crypto-trading-bot',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    // Error log file
    new winston.transports.File({
      filename: join(__dirname, '../../logs/error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      format: fileFormat
    }),
    
    // Combined log file
    new winston.transports.File({
      filename: join(__dirname, '../../logs/combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      format: fileFormat
    }),
    
    // Trading specific log file
    new winston.transports.File({
      filename: join(__dirname, '../../logs/trading.log'),
      level: 'info',
      maxsize: 5242880, // 5MB
      maxFiles: 10,
      format: fileFormat
    })
  ],
  
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({
      filename: join(__dirname, '../../logs/exceptions.log'),
      format: fileFormat
    })
  ],
  
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.File({
      filename: join(__dirname, '../../logs/rejections.log'),
      format: fileFormat
    })
  ]
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat
  }));
}

// Create specialized loggers for different components
export const tradingLogger = logger.child({ component: 'trading' });
export const apiLogger = logger.child({ component: 'api' });
export const websocketLogger = logger.child({ component: 'websocket' });
export const databaseLogger = logger.child({ component: 'database' });

// Utility functions for structured logging
export const logTrade = (action, symbol, data) => {
  tradingLogger.info(`Trade ${action}`, {
    symbol,
    action,
    ...data,
    timestamp: new Date().toISOString()
  });
};

export const logOrder = (orderId, symbol, side, quantity, price, status) => {
  tradingLogger.info('Order update', {
    orderId,
    symbol,
    side,
    quantity,
    price,
    status,
    timestamp: new Date().toISOString()
  });
};

export const logError = (error, context = {}) => {
  logger.error('Application error', {
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name
    },
    context,
    timestamp: new Date().toISOString()
  });
};

export const logPerformance = (operation, duration, details = {}) => {
  logger.info('Performance metric', {
    operation,
    duration: `${duration}ms`,
    ...details,
    timestamp: new Date().toISOString()
  });
};

export const logApiRequest = (method, url, statusCode, duration, userId = null) => {
  apiLogger.info('API request', {
    method,
    url,
    statusCode,
    duration: `${duration}ms`,
    userId,
    timestamp: new Date().toISOString()
  });
};

export const logWebSocketEvent = (event, clientId, data = {}) => {
  websocketLogger.info('WebSocket event', {
    event,
    clientId,
    ...data,
    timestamp: new Date().toISOString()
  });
};

export const logDatabaseOperation = (operation, collection, duration, details = {}) => {
  databaseLogger.info('Database operation', {
    operation,
    collection,
    duration: `${duration}ms`,
    ...details,
    timestamp: new Date().toISOString()
  });
};

// Risk management logging
export const logRiskEvent = (riskType, symbol, currentValue, threshold, action) => {
  logger.warn('Risk management event', {
    riskType,
    symbol,
    currentValue,
    threshold,
    action,
    severity: currentValue > threshold * 1.5 ? 'HIGH' : 'MEDIUM',
    timestamp: new Date().toISOString()
  });
};

// Strategy logging
export const logStrategy = (strategy, symbol, signals, action, confidence) => {
  tradingLogger.info('Strategy decision', {
    strategy,
    symbol,
    signals,
    action,
    confidence,
    timestamp: new Date().toISOString()
  });
};

// Market data logging
export const logMarketData = (symbol, price, volume, indicators) => {
  logger.debug('Market data update', {
    symbol,
    price,
    volume,
    indicators,
    timestamp: new Date().toISOString()
  });
};

// System health logging
export const logSystemHealth = (metrics) => {
  logger.info('System health check', {
    ...metrics,
    timestamp: new Date().toISOString()
  });
};

// Export the main logger as default
export { logger };