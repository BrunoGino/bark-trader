# Cryptocurrency Trading Bot

A sophisticated cryptocurrency trading bot built with Bun, featuring real-time WebSocket updates, MongoDB persistence, Redis caching, and Binance API integration.

## 🚀 Features

- **Automated Trading**: Intelligent trading strategies with technical analysis
- **Real-time WebSocket**: Live order updates and market data streaming
- **Risk Management**: Configurable stop-loss, take-profit, and position sizing
- **Multi-Symbol Support**: Trade multiple cryptocurrencies simultaneously
- **Persistent Storage**: MongoDB for order history and Redis for real-time data
- **RESTful API**: Complete REST API for configuration and monitoring
- **DevContainer Ready**: Full Docker development environment included
- **Technical Analysis**: RSI, MACD, Bollinger Bands, and more indicators

## 📋 Prerequisites

- Docker and Docker Compose
- VS Code with DevContainer extension (recommended)
- Binance API credentials (use testnet for development)

## 🛠️ Quick Start

### Using DevContainer (Recommended)

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd crypto-trading-bot
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your Binance API credentials
   ```

3. **Open in DevContainer**
   - Open VS Code
   - Install the "Dev Containers" extension
   - Press `Ctrl+Shift+P` → "Dev Containers: Reopen in Container"
   - Wait for the container to build and start

4. **Start the application**
   ```bash
   bun dev
   ```

### Manual Setup

1. **Start infrastructure services**
   ```bash
   docker-compose up mongodb redis mongo-express -d
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Start the application**
   ```bash
   bun dev
   ```

## 🔧 Configuration

### Default Trading Configuration

- **Symbols**: BTC, ETH, SOL, ADA, DOGE (USDT pairs)
- **Max Concurrent Trades**: 5
- **Max Loss Per Trade**: $50
- **Trading Window**: 15 minutes
- **Daily Gain Target**: 1-3%
- **Risk Management**: Enabled with stop-loss

### Environment Variables

Key environment variables in `.env`:

```bash
# Binance API (use testnet for development)
BINANCE_API_KEY=your_api_key
BINANCE_SECRET_KEY=your_secret_key
BINANCE_TESTNET=true

# Database connections
MONGODB_URI=mongodb://admin:password123@mongodb:27017/cryptobot?authSource=admin
REDIS_URL=redis://redis:6379

# Application settings
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
```

## 📚 API Documentation

### Trading Endpoints

- `GET /api/trading/orders` - Get order history with pagination
- `GET /api/trading/orders/active` - Get currently active orders
- `GET /api/trading/stats/daily` - Get daily trading statistics
- `POST /api/trading/orders/manual` - Place manual order
- `POST /api/trading/bot/start` - Start trading bot
- `POST /api/trading/bot/stop` - Stop trading bot

### Configuration Endpoints

- `GET /api/config` - Get current configuration
- `PUT /api/config` - Update configuration
- `GET /api/config/symbols` - Get active trading symbols
- `PUT /api/config/symbols` - Update trading symbols
- `GET /api/config/limits` - Get risk limits
- `PUT /api/config/limits` - Update risk limits

### WebSocket Connection

Connect to WebSocket for real-time updates:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};

// Subscribe to specific symbol updates
ws.send(JSON.stringify({
  type: 'SUBSCRIBE_SYMBOL',
  data: { symbol: 'BTCUSDT' }
}));
```

## 🏗️ Architecture

### Core Components

1. **TradingBot** (`src/trading/TradingBot.js`)
   - Main trading logic and strategy execution
   - Binance API integration
   - Order management and position tracking

2. **WebSocketManager** (`src/websocket/WebSocketManager.js`)
   - Real-time client communication
   - Order updates and market data streaming

3. **Database Models**
   - **Order** (`src/models/Order.js`) - Trade history and order tracking
   - **TradingConfig** (`src/models/TradingConfig.js`) - Bot configuration

4. **Technical Analysis** (`src/utils/technicalAnalysis.js`)
   - RSI, MACD, Bollinger Bands calculations
   - Trading signal generation

### Data Flow

```
Market Data → Binance API → Trading Bot → Technical Analysis → Trading Decision
                                    ↓
Order Execution → MongoDB (Persistence) → Redis (Cache) → WebSocket → Client
```

## 📊 Monitoring

### Available Interfaces

- **Main Application**: http://localhost:3000
- **MongoDB UI**: http://localhost:8081 (mongo-express)
- **WebSocket**: ws://localhost:3000/ws
- **API Health**: http://localhost:3000/health

### Log Files

Logs are stored in the `logs/` directory:
- `combined.log` - All application logs
- `error.log` - Error logs only
- `trading.log` - Trading-specific logs
- `exceptions.log` - Uncaught exceptions

## 🔐 Security & Risk Management

### Built-in Safety Features

- **Position Limits**: Maximum concurrent trades
- **Loss Limits**: Per-trade and daily loss limits
- **Stop Loss**: Automatic position closure on adverse moves
- **Testnet Mode**: Safe testing environment
- **Rate Limiting**: API request throttling

### Risk Configuration

```javascript
// Example risk settings
{
  maxLossPerTrade: 50,      // $50 max loss per trade
  maxTotalLoss: 50,         // $50 max daily loss
  maxConcurrentTrades: 5,   // 5 simultaneous positions
  stopLossPercent: 2,       // 2% stop loss
  takeProfitPercent: 3      // 3% take profit
}
```

## 🧪 Testing

### Running Tests

```bash
bun test
```

### Paper Trading

Enable paper trading mode in configuration:

```bash
# In .env
ENABLE_PAPER_TRADING=true
BINANCE_TESTNET=true
```

## 🚀 Deployment

### Production Deployment

1. **Update environment variables**
   ```bash
   NODE_ENV=production
   BINANCE_TESTNET=false
   LOG_LEVEL=warn
   ```

2. **Build and start**
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

3. **Monitor logs**
   ```bash
   docker-compose logs -f app
   ```

### Scaling Considerations

- Use Redis Cluster for high-availability caching
- Configure MongoDB replica sets for production
- Implement proper secrets management
- Set up monitoring and alerting
- Configure reverse proxy (nginx/traefik)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if needed
5. Submit a pull request

## ⚠️ Disclaimer

This trading bot is for educational and research purposes. Cryptocurrency trading involves substantial risk of loss. Never trade with money you cannot afford to lose. Always test thoroughly in testnet mode before using real funds.

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

- Create an issue for bug reports
- Use discussions for questions
- Check existing issues before creating new ones
