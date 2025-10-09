import mongoose from 'mongoose';
import app from './app';
import { config } from './config/env';
import { logger } from './utils/logger';

async function start() {
  try {
    await mongoose.connect(config.mongodb.uri);
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