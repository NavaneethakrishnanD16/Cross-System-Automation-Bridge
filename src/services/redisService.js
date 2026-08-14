import Redis from 'ioredis';
import { env } from '../config/env.js';

class RedisService {
  constructor() {
    this.enabled = env.enableRedisLocking || env.enableRedisCaching;
    this.client = null;
    this.isConnected = false;
    
    if (this.enabled) {
      this.init();
    }
  }

  init() {
    try {
      this.client = new Redis({
        host: env.redisHost,
        port: env.redisPort,
        password: env.redisPassword || undefined,
        db: env.redisDb,
        // Cap reconnect attempts so an unreachable Redis (e.g. the demo
        // running without docker-compose) degrades gracefully instead of
        // retrying forever and keeping the process alive indefinitely.
        retryStrategy: (times) => {
          if (times > 10) return null; // stop retrying, ioredis emits 'end'
          return Math.min(times * 50, 2000);
        },
        maxRetriesPerRequest: 3,
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        console.log('[redis] Connected successfully');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        console.error('[redis] Connection error:', err.message);
      });

      this.client.on('close', () => {
        this.isConnected = false;
        console.warn('[redis] Connection closed');
      });

    } catch (error) {
      console.error('[redis] Failed to initialize:', error.message);
      this.isConnected = false;
    }
  }

  async acquireLock(lockKey, ttlSeconds = 300) {
    if (!this.isConnected || !this.client) {
      return true;
    }

    try {
      const result = await this.client.set(
        `lock:${lockKey}`,
        'locked',
        'NX',
        'EX',
        ttlSeconds
      );
      return result === 'OK';
    } catch (error) {
      console.error('[redis] Lock acquisition failed:', error.message);
      return true;
    }
  }

  async releaseLock(lockKey) {
    if (!this.isConnected || !this.client) {
      return true;
    }

    try {
      const result = await this.client.del(`lock:${lockKey}`);
      return result === 1;
    } catch (error) {
      console.error('[redis] Lock release failed:', error.message);
      return false;
    }
  }

  async cacheData(key, data, ttlSeconds = 60) {
    if (!this.isConnected || !this.client || !env.enableRedisCaching) {
      return false;
    }

    try {
      const serialized = JSON.stringify(data);
      await this.client.set(`cache:${key}`, serialized, 'EX', ttlSeconds);
      return true;
    } catch (error) {
      console.error('[redis] Cache set failed:', error.message);
      return false;
    }
  }

  async getCachedData(key) {
    if (!this.isConnected || !this.client || !env.enableRedisCaching) {
      return null;
    }

    try {
      const data = await this.client.get(`cache:${key}`);
      if (!data) return null;
      return JSON.parse(data);
    } catch (error) {
      console.error('[redis] Cache get failed:', error.message);
      return null;
    }
  }

  async invalidateCache(pattern) {
    if (!this.isConnected || !this.client || !env.enableRedisCaching) {
      return false;
    }

    try {
      const keys = await this.client.keys(`cache:${pattern}`);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
      return true;
    } catch (error) {
      console.error('[redis] Cache invalidation failed:', error.message);
      return false;
    }
  }

  isAvailable() {
    return this.isConnected && this.client !== null;
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit().catch(() => this.client.disconnect());
    }
  }
}

export const redisService = new RedisService();