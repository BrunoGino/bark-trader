import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';
import { dbConfig } from '../config/environment.js';

export async function connectMongoDB() {
  try {
    await mongoose.connect(dbConfig.mongodb.uri, {
      ...dbConfig.mongodb.options,
      socketTimeoutMS: 45000,
      authSource: 'admin',
      retryWrites: true,
      w: 'majority'
    });

    logger.info(`📦 Connected to MongoDB: ${dbConfig.mongodb.uri}`);

    // Handle connection events
    mongoose.connection.on('error', (error) => {
      logger.error('MongoDB connection error:', error);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
    });

    return mongoose.connection;
  } catch (error) {
    logger.error('Failed to connect to MongoDB:', error);
    throw error;
  }
}

export async function disconnectMongoDB() {
  try {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
  } catch (error) {
    logger.error('Error disconnecting from MongoDB:', error);
  }
}

// Export mongoose instance for model creation
export { mongoose };
