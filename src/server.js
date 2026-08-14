import express from 'express';
import '../src/db/connection.js';
import { env } from './config/env.js';
import { bridgeRouter } from './routes/bridge.js';
import { startBridgeScheduler } from './jobs/scheduler.js';
import { getHealthStatus } from './services/healthService.js';
import { redisService } from './services/redisService.js';

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  const health = getHealthStatus();
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

app.use('/api', bridgeRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(env.port, () => {
  console.log(`Cross-system automation bridge listening on port ${env.port}`);
  console.log(`Redis enabled: ${process.env.ENABLE_REDIS_LOCKING !== 'false' || process.env.ENABLE_REDIS_CACHING !== 'false'}`);
  startBridgeScheduler();
});

async function shutdown(signal) {
  console.log(`${signal} signal received: closing HTTP server`);
  server.close(async () => {
    await redisService.disconnect();
    console.log('HTTP server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));