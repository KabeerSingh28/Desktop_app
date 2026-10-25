/**
 * Athena Exam Backend Server Entry Point
 *
 * Runs the Express application on the configured port.
 */

import { app } from './app.js';
import { config } from './config.js';
import { ensureDataDir } from './storage.js';

async function start() {
  await ensureDataDir();

  const server = app.listen(config.port, () => {
    console.log(`Exam backend running at http://localhost:${config.port}`);
  });

  // Graceful shutdown handling
  const shutdown = () => {
    console.log('\nShutting down exam backend gracefully...');
    server.close(() => {
      console.log('Backend server stopped.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('Fatal startup error in exam backend:', err);
  process.exit(1);
});
