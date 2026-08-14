import { redisService } from './redisService.js';
import { db } from '../db/connection.js';

export function getHealthStatus() {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    components: {
      database: {
        status: 'healthy',
        details: {
          file: process.env.DATABASE_FILE || './data/bridge.db'
        }
      },
      redis: {
        status: 'unknown',
        details: {}
      },
      bridge: {
        status: 'healthy',
        details: {
          cronSchedule: process.env.BRIDGE_CRON_SCHEDULE || '*/5 * * * *'
        }
      }
    }
  };

  try {
    db.prepare('SELECT 1').get();
    health.components.database.status = 'healthy';
  } catch (error) {
    health.components.database.status = 'unhealthy';
    health.components.database.details.error = error.message;
    health.status = 'degraded';
  }

  try {
    if (redisService.isAvailable()) {
      health.components.redis.status = 'healthy';
      health.components.redis.details = {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379
      };
    } else {
      health.components.redis.status = 'unavailable';
      if (process.env.ENABLE_REDIS_LOCKING === 'true' || process.env.ENABLE_REDIS_CACHING === 'true') {
        health.status = 'degraded';
      }
    }
  } catch (error) {
    health.components.redis.status = 'unhealthy';
    health.components.redis.details.error = error.message;
    if (process.env.ENABLE_REDIS_LOCKING === 'true' || process.env.ENABLE_REDIS_CACHING === 'true') {
      health.status = 'degraded';
    }
  }

  return health;
}