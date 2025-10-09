import mongoose from 'mongoose';
import app from './app';
import { config } from './config/env';
import { logger } from './utils/logger';

async function connectMongoWithRetry(uri: string, retries = 5, baseDelayMs = 2000) {
  let attempt = 0;
  for (;;) {
    try {
      await mongoose.connect(uri);
      logger.info('Connected to MongoDB');
      return;
    } catch (err: any) {
      attempt++;
      if (attempt > retries) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      logger.warn('MongoDB connection failed, retrying...', { attempt, delayMs: delay, message: err?.message });
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

async function start() {
  try {
    await connectMongoWithRetry(config.mongodb.uri);
    logger.info('Connected to MongoDB');

    const server = app.listen(config.port, () => {
      logger.info(`Server listening on port ${config.port}`);
    });

    const shutdown = (signal: string) => {
      logger.info(`Received ${signal}, shutting down...`);
      server.close(() => {
        mongoose.connection.close(false).then(() => process.exit(0));
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    logger.error('Failed to start server', err);
    process.exit(1);
  }
}

start();