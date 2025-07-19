import { logger } from '../utils/logger.js';
import { redis } from '../database/redis.js';

export class WebSocketManager {
  constructor(wss) {
    this.wss = wss;
    this.clients = new Set();
    this.setupWebSocketServer();
  }

  setupWebSocketServer() {
    this.wss.on('connection', (ws, request) => {
      logger.info(`New WebSocket connection from ${request.socket.remoteAddress}`);
      
      this.clients.add(ws);      
      this.sendInitialData(ws);
      
      ws.on('message', async (message) => {
        try {
          await this.handleMessage(ws, JSON.parse(message.toString()));
        } catch (error) {
          logger.error('WebSocket message error:', error);
          this.sendError(ws, 'Invalid message format');
        }
      });
      
      ws.on('close', () => {
        this.clients.delete(ws);
        logger.info('WebSocket connection closed');
      });
      
      ws.on('error', (error) => {
        logger.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
            
      const heartbeat = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
          ws.ping();
        } else {
          clearInterval(heartbeat);
        }
      }, 30000);
      
      ws.on('pong', () => {
        
      });
    });
  }

  async sendInitialData(ws) {
    try {      
      const activeOrders = await redis.hgetall('active_orders');
      const ordersArray = Object.entries(activeOrders).map(([symbol, data]) => ({
        symbol,
        ...JSON.parse(data)
      }));
      
      const recentOrders = await this.getRecentOrders();

      this.send(ws, {
        type: 'INITIAL_DATA',
        data: {
          activeOrders: ordersArray,
          recentOrders,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      logger.error('Failed to send initial data:', error);
    }
  }

  async handleMessage(ws, message) {
    const { type, data } = message;
    
    switch (type) {
      case 'SUBSCRIBE_SYMBOL':
        await this.handleSubscribeSymbol(ws, data.symbol);
        break;
        
      case 'UNSUBSCRIBE_SYMBOL':
        await this.handleUnsubscribeSymbol(ws, data.symbol);
        break;
        
      case 'GET_ORDER_HISTORY':
        await this.handleGetOrderHistory(ws, data);
        break;
        
      case 'GET_DAILY_STATS':
        await this.handleGetDailyStats(ws);
        break;
        
      default:
        this.sendError(ws, `Unknown message type: ${type}`);
    }
  }

  async handleSubscribeSymbol(ws, symbol) {    
    if (!ws.subscribedSymbols) {
      ws.subscribedSymbols = new Set();
    }
    ws.subscribedSymbols.add(symbol);
    
    this.send(ws, {
      type: 'SUBSCRIBED',
      data: { symbol, message: `Subscribed to ${symbol}` }
    });
  }

  async handleUnsubscribeSymbol(ws, symbol) {
    if (ws.subscribedSymbols) {
      ws.subscribedSymbols.delete(symbol);
    }
    
    this.send(ws, {
      type: 'UNSUBSCRIBED',
      data: { symbol, message: `Unsubscribed from ${symbol}` }
    });
  }

  async handleGetOrderHistory(ws, { limit = 50, symbol, dateFrom, dateTo }) {
    try {
      const { Order } = await import('../models/Order.js');
      
      let query = {};
      
      if (symbol) {
        query.symbol = symbol;
      }
      
      if (dateFrom || dateTo) {
        query.timestamp = {};
        if (dateFrom) query.timestamp.$gte = new Date(dateFrom);
        if (dateTo) query.timestamp.$lte = new Date(dateTo);
      }
      
      const orders = await Order.find(query)
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean();
      
      this.send(ws, {
        type: 'ORDER_HISTORY',
        data: { orders, timestamp: new Date().toISOString() }
      });
      
    } catch (error) {
      logger.error('Failed to get order history:', error);
      this.sendError(ws, 'Failed to retrieve order history');
    }
  }

  async handleGetDailyStats(ws) {
    try {
      const { Order } = await import('../models/Order.js');
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const orders = await Order.find({
        timestamp: { $gte: today }
      }).lean();
            
      const stats = {
        totalTrades: orders.length,
        buyOrders: orders.filter(o => o.side === 'BUY').length,
        sellOrders: orders.filter(o => o.side === 'SELL').length,
        totalPnL: orders.reduce((sum, o) => sum + (o.pnl || 0), 0),
        winningTrades: orders.filter(o => o.pnl > 0).length,
        losingTrades: orders.filter(o => o.pnl < 0).length,
        symbolStats: {}
      };
            
      const symbolGroups = orders.reduce((acc, order) => {
        if (!acc[order.symbol]) acc[order.symbol] = [];
        acc[order.symbol].push(order);
        return acc;
      }, {});
      
      Object.entries(symbolGroups).forEach(([symbol, symbolOrders]) => {
        stats.symbolStats[symbol] = {
          trades: symbolOrders.length,
          pnl: symbolOrders.reduce((sum, o) => sum + (o.pnl || 0), 0),
          volume: symbolOrders.reduce((sum, o) => sum + (o.quantity * o.price), 0)
        };
      });
      
      this.send(ws, {
        type: 'DAILY_STATS',
        data: { stats, timestamp: new Date().toISOString() }
      });
      
    } catch (error) {
      logger.error('Failed to get daily stats:', error);
      this.sendError(ws, 'Failed to retrieve daily statistics');
    }
  }

  async getRecentOrders() {
    try {
      const { Order } = await import('../models/Order.js');
      return await Order.find({})
        .sort({ timestamp: -1 })
        .limit(20)
        .lean();
    } catch (error) {
      logger.error('Failed to get recent orders:', error);
      return [];
    }
  }

  send(ws, message) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  sendError(ws, error) {
    this.send(ws, {
      type: 'ERROR',
      data: { error, timestamp: new Date().toISOString() }
    });
  }

  broadcast(message) {
    const messageStr = JSON.stringify(message);
    
    this.clients.forEach(ws => {
      if (ws.readyState === ws.OPEN) {        
        if (message.type === 'PRICE_UPDATE' && ws.subscribedSymbols) {
          if (!ws.subscribedSymbols.has(message.data.symbol)) {
            return;
          }
        }
        
        ws.send(messageStr);
      } else {
        this.clients.delete(ws);
      }
    });
  }

  broadcastToSubscribers(symbol, message) {
    this.clients.forEach(ws => {
      if (ws.readyState === ws.OPEN && 
          ws.subscribedSymbols && 
          ws.subscribedSymbols.has(symbol)) {
        this.send(ws, message);
      }
    });
  }

  getConnectedClientsCount() {
    return this.clients.size;
  }

  async broadcastOrderUpdate(order) {    
    await redis.setex(
      `order_update:${order.orderId}`, 
      3600, // 1 hour TTL
      JSON.stringify(order)
    );

    this.broadcast({
      type: 'ORDER_UPDATE',
      data: {
        order,
        timestamp: new Date().toISOString()
      }
    });
  }

  async broadcastPositionUpdate(symbol, position) {    
    if (position) {
      await redis.hset('active_orders', symbol, JSON.stringify(position));
    } else {
      await redis.hdel('active_orders', symbol);
    }

    this.broadcast({
      type: 'POSITION_UPDATE',
      data: {
        symbol,
        position,
        timestamp: new Date().toISOString()
      }
    });
  }
}