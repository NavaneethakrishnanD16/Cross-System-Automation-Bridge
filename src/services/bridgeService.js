import { db } from '../db/connection.js';
import { redisService } from './redisService.js';

function priorityForMaintenanceType(type) {
  const highPriorityTypes = ['Load Test', 'Certification Check', 'Battery Health Check'];
  return highPriorityTypes.includes(type) ? 'high' : 'medium';
}

async function findUnsyncedDueEvents() {
  const cacheKey = 'unsynced_due_events';
  const cached = await redisService.getCachedData(cacheKey);

  if (cached) {
    return cached;
  }

  const events = db
    .prepare(
      `SELECT e.*
       FROM pm_events e
       LEFT JOIN bridge_sync_log s ON s.source_event_id = e.id
       WHERE e.scheduled_date <= datetime('now')
         AND s.id IS NULL`
    )
    .all();

  await redisService.cacheData(cacheKey, events, 30);
  return events;
}

const insertTicket = db.prepare(`
  INSERT INTO tickets (title, description, priority, department)
  VALUES (@title, @description, @priority, @department)
`);

const insertSyncLog = db.prepare(`
  INSERT INTO bridge_sync_log (source_event_id, ticket_id)
  VALUES (@sourceEventId, @ticketId)
`);

function createTicketForEvent(event) {
  const createTicketTxn = db.transaction((event) => {
    const ticketResult = insertTicket.run({
      title: `Preventive Maintenance Due: ${event.asset_name}`,
      description:
        `Maintenance type: ${event.maintenance_type}\n` +
        `Asset ID: ${event.asset_id}\n` +
        `Scheduled date: ${event.scheduled_date}\n` +
        (event.notes ? `Notes: ${event.notes}` : ''),
      priority: priorityForMaintenanceType(event.maintenance_type),
      department: event.department,
    });

    const ticketId = ticketResult.lastInsertRowid;
    insertSyncLog.run({ sourceEventId: event.id, ticketId });
    return ticketId;
  });

  return createTicketTxn(event);
}

export async function runBridgeCycle() {
  const lockAcquired = await redisService.acquireLock('bridge_cycle', 300);

  if (!lockAcquired) {
    return {
      runId: null,
      eventsChecked: 0,
      ticketsCreated: 0,
      skippedDuplicates: 0,
      createdTickets: [],
      skipped: true,
      reason: 'Another cycle is already running'
    };
  }

  try {
    const startedAt = new Date().toISOString();
    const runLogResult = db
      .prepare(`INSERT INTO bridge_run_log (started_at, status) VALUES (?, 'running')`)
      .run(startedAt);
    const runId = runLogResult.lastInsertRowid;

    const dueEvents = await findUnsyncedDueEvents();
    let ticketsCreated = 0;
    let skippedDuplicates = 0;
    const createdTickets = [];

    for (const event of dueEvents) {
      const eventLockAcquired = await redisService.acquireLock(`event_${event.id}`, 60);

      if (!eventLockAcquired) {
        skippedDuplicates += 1;
        continue;
      }

      try {
        const ticketId = createTicketForEvent(event);
        ticketsCreated += 1;
        createdTickets.push({ eventId: event.id, ticketId, asset: event.asset_name });
        await redisService.invalidateCache('unsynced_due_events');
      } catch (err) {
        if (String(err.message).includes('UNIQUE constraint failed')) {
          skippedDuplicates += 1;
        } else {
          throw err;
        }
      } finally {
        await redisService.releaseLock(`event_${event.id}`);
      }
    }

    db.prepare(
      `UPDATE bridge_run_log
       SET finished_at = ?, events_checked = ?, tickets_created = ?, skipped_duplicates = ?, status = 'completed'
       WHERE id = ?`
    ).run(new Date().toISOString(), dueEvents.length, ticketsCreated, skippedDuplicates, runId);

    return {
      runId,
      eventsChecked: dueEvents.length,
      ticketsCreated,
      skippedDuplicates,
      createdTickets,
      redisEnabled: redisService.isAvailable()
    };
  } finally {
    await redisService.releaseLock('bridge_cycle');
  }
}