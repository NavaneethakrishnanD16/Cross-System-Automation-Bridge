import { runBridgeCycle } from '../services/bridgeService.js';
import { redisService } from '../services/redisService.js';

const result = await runBridgeCycle();
console.log(JSON.stringify(result, null, 2));

// Close the Redis connection (if any) so this one-shot script exits
// promptly instead of waiting on reconnect timers.
await redisService.disconnect();
process.exit(0);