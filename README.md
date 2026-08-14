# Cross-System Automation Bridge (Preventive Maintenance → Ticketing)

A scheduled service that detects due preventive-maintenance events in one
system and automatically creates a corresponding ticket in a separate
ticketing system — with a database-enforced guarantee that the same event
can never produce two tickets, even under retries or overlapping runs.

## Why this exists

Manually checking "is anything due for maintenance today?" and hand-creating
tickets for it doesn't scale past a handful of assets, and is exactly the
kind of cross-checking that gets missed under workload. This project
demonstrates the automated alternative: a scheduled job that closes the gap
between two systems that otherwise don't talk to each other.

The harder problem this solves isn't "create a ticket" — it's **guaranteeing
exactly-once creation**. A naive polling job that runs every 5 minutes will
happily create the same ticket over and over if you don't explicitly prevent
it, especially if a run overlaps the next one or gets retried after a crash.

## How it works

1. **Two systems, one bridge.** `pm_events` stands in for a maintenance/asset
   system; `tickets` stands in for a separate ticketing system. In production
   these would typically be two different databases or services — they're
   modeled as two tables here to keep the demo runnable without standing up
   two servers.
2. **Detection.** On each scheduled run, the bridge finds every PM event
   whose `scheduled_date` has passed and that has **no existing row** in
   `bridge_sync_log` (a `LEFT JOIN ... WHERE sync_log.id IS NULL`).
3. **Exactly-once guarantee, two layers deep.** `bridge_sync_log.source_event_id`
   has a `UNIQUE` constraint, and ticket creation + the sync-log insert happen
   in a single SQLite transaction — the database itself rejects a second
   insert for an already-synced event. On top of that, if Redis is
   configured, the bridge takes a distributed lock (`SET NX EX`) per cycle
   and per event before touching it, so two overlapping instances of the
   service (e.g. two containers, a rolling deploy) can't even both attempt
   the same event at once. **Redis is optional** — if it's unreachable or
   disabled, locking degrades to "always allowed" and the DB unique
   constraint is still the final backstop, so correctness never depends on
   Redis being up.
4. **Scheduling.** `node-cron` runs the cycle on an interval (configurable
   via `BRIDGE_CRON_SCHEDULE`). A manual trigger (`POST /api/run-now`) is
   also exposed for on-demand runs/demos.
5. **Run history.** Every cycle is logged to `bridge_run_log` — events
   checked, tickets created, duplicates skipped — so you can audit exactly
   what the automation did over time.
6. **Caching.** The due-events lookup is cached in Redis for 30s (when
   enabled) and invalidated as soon as a new ticket is created, so a burst of
   manual `/api/run-now` calls doesn't repeatedly hit SQLite for a query
   whose result rarely changes between cron ticks.

## Real bugs this caught during testing

Worth mentioning on its own, since both only surfaced by actually running
the service rather than just reading the code:

- **String-compared dates.** `toISOString()` output
  (`2026-08-11T15:32:13.042Z`) was being compared against SQLite's own
  `datetime('now')` output (`2026-08-11 15:32:28`) as plain strings in the
  `WHERE` clause. Because `"T"` sorts after a space character, a same-day
  event was silently excluded from the due-events query even though it
  should have matched. Fixed with a shared `toSqliteDatetime()` helper that
  normalizes JS dates to SQLite's own format before they're ever compared.
- **Unawaited async locks.** `redisService`'s locking/caching methods are
  `async`, but the bridge cycle originally called them without `await`. A
  pending `Promise` is always truthy, so `acquireLock()` always "succeeded"
  and `findUnsyncedDueEvents()` returned a `Promise` instead of an array —
  which crashed the very first run with `TypeError: dueEvents is not
  iterable`. Fixed by threading `async`/`await` through the whole call chain
  (`bridgeService` → routes → the cron job → the CLI script), with the
  CLI/test scripts also explicitly closing the Redis connection on exit so
  they don't hang on reconnect timers when Redis isn't running.

This is why every event in the seed data is run through the bridge twice in
the steps below (once to create tickets, once to confirm zero duplicates) —
and why it's worth running the actual commands below rather than trusting
that the code "looks right."

## Stack

Node.js, Express, SQLite (`better-sqlite3`), `node-cron`, Redis (`ioredis`, optional).

> This demo uses SQLite for zero-setup local testing (no external DB server
> required). The pattern — detection query, transactional dedup via a unique
> constraint, scheduled execution, run auditing — applies identically against
> MySQL/Postgres in a production setting. Redis is likewise optional: run
> `npm run run-bridge-once` / `npm start` directly and the service falls back
> to DB-only dedup, or run `npm run docker:up` to bring up Redis alongside
> the app via `docker-compose.yml` and get distributed locking + caching.

## Project structure

```
src/
  config/env.js            # env loading
  db/connection.js         # schema: pm_events, tickets, bridge_sync_log, bridge_run_log
  db/dateHelper.js         # JS Date -> SQLite datetime string normalization
  db/seed.js                # sample PM events for local testing
  services/bridgeService.js # core detection + dedup + ticket creation logic
  jobs/scheduler.js         # cron wrapper around the bridge cycle
  jobs/runOnce.js           # CLI script to trigger one cycle manually
  routes/bridge.js          # inspection + manual-trigger API
```

## Running locally

```bash
npm install
cp .env.example .env
npm run seed              # creates sample PM events (some due, one future-dated)
npm run run-bridge-once   # runs one cycle from the CLI, prints the result as JSON
npm run run-bridge-once   # run again — confirm ticketsCreated is now 0 (dedup working)
npm start                 # starts the API + cron scheduler
```

### API

| Method | Route              | Purpose                                   |
|--------|--------------------|--------------------------------------------|
| GET    | `/api/pm-events`   | List all maintenance events                |
| GET    | `/api/tickets`     | List all created tickets                   |
| GET    | `/api/sync-log`    | List event→ticket sync mappings            |
| GET    | `/api/run-log`     | History of bridge runs (audit trail)       |
| POST   | `/api/run-now`     | Manually trigger one bridge cycle          |
| GET    | `/api/health`      | Service health (DB + Redis status)         |
| GET    | `/api/redis-status`| Whether Redis locking/caching are active   |
| DELETE | `/api/cache/:pattern?` | Manually invalidate the Redis cache    |

There's also a top-level `GET /health` (same payload as `/api/health`) for
load balancers/orchestrators that expect health checks off the root path.

## Notes

Built to demonstrate the detection + exactly-once-dedup pattern clearly. A
few things are deliberately left out to keep the core logic easy to read:
there's no retry/backoff policy for downstream failures (e.g. if ticket
creation succeeds but the sync-log insert somehow fails outside the
transaction), no dead-letter handling for events that repeatedly fail to
sync, and the Redis locks are advisory (best-effort coordination, not a
replacement for the DB constraint) rather than a fully fenced distributed
lock implementation.
