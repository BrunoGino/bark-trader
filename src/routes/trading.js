import express from 'express';
import { Order } from '../models/Order.js';
import { redis } from '../database/redis.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.get('/orders', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            symbol,
            side,
            status,
            dateFrom,
            dateTo,
            sortBy = 'timestamp',
            sortOrder = 'desc'
        } = req.query;
        
        const query = {};
        if (symbol) query.symbol = symbol.toUpperCase();
        if (side) query.side = side.toUpperCase();
        if (status) query.status = status.toUpperCase();

        if (dateFrom || dateTo) {
            query.timestamp = {};
            if (dateFrom) query.timestamp.$gte = new Date(dateFrom);
            if (dateTo) query.timestamp.$lte = new Date(dateTo);
        }

        // Execute query with pagination
        const orders = await Order.find(query)
            .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .lean();

        const total = await Order.countDocuments(query);

        res.json({
            success: true,
            data: {
                orders,
                pagination: {
                    current: parseInt(page),
                    pages: Math.ceil(total / limit),
                    total,
                    limit: parseInt(limit)
                }
            }
        });

    } catch (error) {
        logger.error('Get orders error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve orders'
        });
    }
});

router.get('/orders/active', async (req, res) => {
    try {
        const activeOrders = await redis.hgetall('active_orders');
        const ordersArray = Object.entries(activeOrders).map(([symbol, data]) => ({
            symbol,
            ...JSON.parse(data)
        }));

        res.json({
            success: true,
            data: {
                activeOrders: ordersArray,
                count: ordersArray.length
            }
        });

    } catch (error) {
        logger.error('Get active orders error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve active orders'
        });
    }
});

router.get('/orders/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await Order.findOne({ orderId }).lean();

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }

        res.json({
            success: true,
            data: { order }
        });

    } catch (error) {
        logger.error('Get order error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve order'
        });
    }
});

router.get('/stats/daily', async (req, res) => {
    try {
        const { date } = req.query;
        const targetDate = date ? new Date(date) : new Date();

        const stats = await Order.calculateDailyPnL(targetDate);
        
        const startDate = new Date(targetDate);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);

        const dailyOrders = await Order.find({
            timestamp: { $gte: startDate, $lt: endDate }
        }).lean();

        const totalStats = {
            date: targetDate.toISOString().split('T')[0],
            totalTrades: dailyOrders.length,
            totalVolume: dailyOrders.reduce((sum, o) => sum + (o.quantity * o.price), 0),
            totalPnL: dailyOrders.reduce((sum, o) => sum + (o.pnl || 0), 0),
            winningTrades: dailyOrders.filter(o => o.pnl > 0).length,
            losingTrades: dailyOrders.filter(o => o.pnl < 0).length,
            buyOrders: dailyOrders.filter(o => o.side === 'BUY').length,
            sellOrders: dailyOrders.filter(o => o.side === 'SELL').length,
            symbolStats: stats
        };

        res.json({
            success: true,
            data: { totalStats }
        })

    } catch (e) {
        logger.error('Get stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve stats'
        });
    }
});

export default router;