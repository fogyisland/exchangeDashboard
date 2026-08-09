import express from 'express';
import pinoHttp from 'pino-http';

export function createApp({ config, db, logger, needsInit }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  if (logger) app.use(pinoHttp({ logger }));
  app.locals.config = config;
  app.locals.db = db;
  app.locals.needsInit = needsInit;
  return app;
}
