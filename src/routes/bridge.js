import { Router } from 'express';
import { db } from '../db/connection.js';
import { runBridgeCycle } from '../services/bridgeService.js';
import { getHealthStatus } from '../services/healthService.js';
import { redisService } from '../services/redisService.js';

export const bridgeRouter = Router();

bridgeRouter.get('/pm-events', (req, res) => {
  const events = db.prepare('SELECT * FROM pm_events ORDER BY scheduled_date DESC').all();
  res.json({ events });
});

bridgeRouter.get('/tickets', (req, res) => {
  const tickets = db.prepare('SELECT * FROM tickets ORDER BY created_at DESC').all();
  res.json({ tickets });
});

bridgeRouter.get('/sync-log', (req, res) => {
  const log = db
    .prepare(
      `SELECT s.id, s.source_event_id, s.ticket_id, s.synced_at, e.asset_name, t.title
       FROM bridge_sync_log s
       JOIN pm_events e ON e.id = s.source_event_id
       JOIN tickets t ON t.id = s.ticket_id
       ORDER BY s.synced_at DESC`
    )
    .all();
  res.json({ syncLog: log });
});

bridgeRouter.get('/run-log', (req, res) => {
  const runs = db.prepare('SELECT * FROM bridge_run_log ORDER BY id DESC LIMIT 20').all();
  res.json({ runs });
});

bridgeRouter.post('/run-now', async (req, res) => {
  try {
    const result = await runBridgeCycle();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

bridgeRouter.get('/health', (req, res) => {
  const health = getHealthStatus();
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

bridgeRouter.get('/redis-status', (req, res) => {
  res.json({
    enabled: redisService.isAvailable(),
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    features: {
      locking: process.env.ENABLE_REDIS_LOCKING !== 'false',
      caching: process.env.ENABLE_REDIS_CACHING !== 'false'
    }
  });
});

bridgeRouter.delete('/cache/:pattern?', async (req, res) => {
  const pattern = req.params.pattern || '*';
  try {
    await redisService.invalidateCache(pattern);
    res.json({ message: `Cache invalidated for pattern: ${pattern}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});