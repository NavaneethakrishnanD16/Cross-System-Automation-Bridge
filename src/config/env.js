import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT || 4100),
  databaseFile: process.env.DATABASE_FILE || './data/bridge.db',
  bridgeCronSchedule: process.env.BRIDGE_CRON_SCHEDULE || '*/5 * * * *',
  redisHost: process.env.REDIS_HOST || 'localhost',
  redisPort: Number(process.env.REDIS_PORT || 6379),
  redisPassword: process.env.REDIS_PASSWORD || '',
  redisDb: Number(process.env.REDIS_DB || 0),
  enableRedisLocking: process.env.ENABLE_REDIS_LOCKING !== 'false',
  enableRedisCaching: process.env.ENABLE_REDIS_CACHING !== 'false',
  lockTtlSeconds: Number(process.env.LOCK_TTL_SECONDS || 300),
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS || 60),
};