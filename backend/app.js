/**
 * Express Application Setup
 *
 * Configures CORS, JSON parsing, routes, and centralized error handling.
 * Exported separately from server.js to allow unit/integration testing with ephemeral ports.
 */

import express from 'express';
import cors from 'cors';
import { examRouter } from './routes/exam.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check endpoint
  app.get('/', (req, res) => {
    res.json({ message: 'Exam backend is running', status: 'ok' });
  });

  // Mount exam API
  app.use('/exam', examRouter);

  // 404 Handler
  app.use((req, res) => {
    res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
  });

  // Global Error Handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[backend error]:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
    });
  });

  return app;
}

export const app = createApp();
