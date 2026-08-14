import { db } from './connection.js';
import { toSqliteDatetime } from './dateHelper.js';

const insert = db.prepare(`
  INSERT INTO pm_events (asset_id, asset_name, department, maintenance_type, scheduled_date, notes)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const now = new Date();
const daysAgo = (n) => toSqliteDatetime(new Date(now.getTime() - n * 86400000));
const daysFromNow = (n) => toSqliteDatetime(new Date(now.getTime() + n * 86400000));

const sampleEvents = [
  ['AST-1042', 'HVAC Unit - Block A', 'Facilities', 'Filter Replacement', daysAgo(1), 'Quarterly filter change'],
  ['AST-2091', 'Server Rack Cooling Fan #3', 'IT Infrastructure', 'Fan Inspection', daysAgo(2), 'Vibration reported last cycle'],
  ['AST-3310', 'Generator Backup Unit B', 'Facilities', 'Load Test', daysAgo(0), 'Monthly load test due'],
  ['AST-4477', 'Fire Suppression Panel - Floor 3', 'Safety', 'Certification Check', daysFromNow(5), 'Not yet due'],
  ['AST-5502', 'UPS Battery Bank 2', 'IT Infrastructure', 'Battery Health Check', daysAgo(3), 'Battery age > 3 years'],
];

const insertMany = db.transaction((events) => {
  for (const e of events) insert.run(...e);
});

insertMany(sampleEvents);

console.log(`Seeded ${sampleEvents.length} sample PM events`);