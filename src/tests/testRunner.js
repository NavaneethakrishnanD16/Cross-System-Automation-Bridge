import { db } from '../db/connection.js';
import { runBridgeCycle } from '../services/bridgeService.js';
import { toSqliteDatetime } from '../db/dateHelper.js';
import { redisService } from '../services/redisService.js';

console.log('Running integration tests...\n');

// Test 1: Database connection
console.log('Test 1: Database connection');
try {
  db.prepare('SELECT 1').get();
  console.log('Database connection successful\n');
} catch (error) {
  console.error('Database connection failed:', error.message);
  process.exit(1);
}

// Test 2: Seed data exists
console.log('Test 2: Seed data verification');
const events = db.prepare('SELECT COUNT(*) as count FROM pm_events').get();
console.log(`Found ${events.count} events in database\n`);

// Test 3: Bridge cycle execution
console.log('Test 3: Bridge cycle execution');
try {
  const result = await runBridgeCycle();
  console.log(' Bridge cycle completed');
  console.log(`Events checked: ${result.eventsChecked}`);
  console.log(`Tickets created: ${result.ticketsCreated}`);
  console.log(`Skipped duplicates: ${result.skippedDuplicates}`);
  console.log(`Redis enabled: ${result.redisEnabled || false}\n`);
} catch (error) {
  console.error(' Bridge cycle failed:', error.message);
  process.exit(1);
}

// Test 4: Dedup verification
console.log('Test 4: Dedup verification');
const duplicates = db
  .prepare(
    `SELECT source_event_id, COUNT(*) as count 
     FROM bridge_sync_log 
     GROUP BY source_event_id 
     HAVING COUNT(*) > 1`
  )
  .all();

if (duplicates.length === 0) {
  console.log('No duplicate sync entries found\n');
} else {
  console.error('Found duplicate sync entries:', duplicates);
  process.exit(1);
}

// Test 5: Ticket creation verification
console.log('Test 5: Ticket creation verification');
const tickets = db.prepare('SELECT COUNT(*) as count FROM tickets').get();
const syncLog = db.prepare('SELECT COUNT(*) as count FROM bridge_sync_log').get();

if (tickets.count === syncLog.count) {
  console.log(`All ${tickets.count} tickets have sync records\n`);
} else {
  console.error(`Mismatch: ${tickets.count} tickets vs ${syncLog.count} sync records`);
  process.exit(1);
}

console.log('All tests passed successfully!');

await redisService.disconnect();
process.exit(0);