# Time-Off Microservice — Technical Requirements

**Author:** Saurav Singh
**Date:** 2026-05-27

---

## Background

ReadyOn lets employees request time off, but the HCM system (Workday, SAP, etc.) is the real source of truth for leave balances. The problem is keeping both in sync. HCM can change balances on its own — work anniversaries, year-start resets — without telling ReadyOn. And when an employee submits a request through ReadyOn, we need to make sure HCM agrees before we approve it.

This service handles time-off requests end to end and keeps balances accurate between the two systems.

---

## The challenges

**Balances can change in HCM without us knowing.** An employee might see 10 days in ReadyOn but HCM already updated it to 5 after a correction. Our local copy goes stale silently.

**HCM doesn't always tell us when something is wrong.** Normally HCM returns an error if a balance is insufficient, but we can't always count on that. We need to validate on our end too.

**Two approvals can happen at the same time.** If two managers approve different requests for the same employee at the same millisecond, they could both see enough balance before either one deducts. We need to handle this.

**Batch syncs can't just overwrite everything.** When HCM sends us a full dump of all balances, it doesn't know about requests we've already approved but haven't fully processed yet. A naive overwrite would cause double-booking.

---

## How we're solving this

We keep a local copy of HCM balances in our own database. This isn't because we don't trust HCM — it's so reads are fast and the UI keeps working even if HCM is temporarily down. But before we ever approve a request and deduct days, we always check HCM live.

When a manager approves a request, we immediately "reserve" those days locally before calling HCM. This blocks any other concurrent approval from seeing those days as available. If HCM confirms, we finalize. If HCM rejects or is down, we release the reservation and the request stays pending.

For concurrent writes we use optimistic locking — a version number on the balance row. If two writes happen at the same time, one will detect the conflict and retry. No locks held, no blocked reads.

---

## Data model

We have three tables.

**balances** — our local mirror of HCM balances, one row per employee per location.

```
id, employeeId, locationId
hcmBalance     -- what HCM says
reservedDays   -- days approved but not yet confirmed by HCM
availableDays  -- hcmBalance - reservedDays (computed)
lastSyncedAt
version        -- for optimistic locking
```

**time_off_requests** — every request an employee submits.

```
id, employeeId, locationId
startDate, endDate, daysRequested
status         -- see lifecycle below
requestedAt, resolvedAt, resolvedBy
failureReason
idempotencyKey -- prevents duplicate submissions
```

**sync_logs** — an immutable record of every balance change, for audit purposes.

```
id, employeeId, locationId
syncType       -- what caused the change (batch, reservation, HCM confirm, etc.)
previousHcmBal, newHcmBal
triggeredBy    -- request ID or 'batch'
createdAt
```

A request moves through these statuses:

```
PENDING_APPROVAL  →  HCM_SUBMITTING  →  HCM_CONFIRMED
                                     →  HCM_FAILED
                  →  REJECTED
                  →  CANCELLED
```

---

## API

All endpoints are under `/api/v1`.

**Balance**
- `GET /balances/:employeeId/:locationId` — returns the current balance from cache. Add `?refresh=true` to pull fresh from HCM first.
- `POST /balances/sync` — force a sync for a specific employee and location.
- `POST /balances/batch` — HCM calls this to push a full balance update. We process it and write audit logs. Safe to call multiple times with the same batch ID.

**Requests**
- `POST /time-off-requests` — submit a new request. Clients should send an `Idempotency-Key` header to avoid duplicates.
- `GET /time-off-requests/:id` — get a specific request.
- `GET /time-off-requests` — list requests, filterable by employee, location, status.
- `POST /time-off-requests/:id/approve` — manager approves. We respond with `HCM_SUBMITTING` straight away and finish the HCM call in the background.
- `POST /time-off-requests/:id/reject` — manager rejects.
- `POST /time-off-requests/:id/cancel` — cancel a request. If it was already confirmed by HCM, we call HCM to restore the days first.

---

## How a request flows through the system

**Normal case — employee requests 3 days, gets approved:**

1. Employee submits a request. We check locally that they have enough balance and save it as `PENDING_APPROVAL`. No HCM call yet.
2. Manager approves. We check locally again, then call HCM live to confirm the balance is still there.
3. We immediately set `reservedDays += 3` so no other approval can use those days.
4. We send the deduction to HCM. HCM confirms.
5. We update `hcmBalance -= 3` and `reservedDays -= 3` in one step. Status becomes `HCM_CONFIRMED`.

**HCM has less balance than our cache shows:**

1. Manager approves a request for 3 days.
2. Local check passes — cache says 10 days.
3. We call HCM live — HCM returns 2 days.
4. 2 is less than 3, so we reject with a 422. Request stays `PENDING_APPROVAL`. We update our local cache to 2.

**HCM is down:**

1. Manager approves.
2. Local check passes.
3. HCM call times out or returns a 503.
4. We return a 503. Request stays `PENDING_APPROVAL`. No reservation made. Manager tries again later.

**HCM rejects the deduction after we already reserved:**

1. Both checks pass. We reserve 3 days.
2. We send the deduction to HCM — HCM returns a 422.
3. We release the reservation. Status becomes `HCM_FAILED`.
4. We refresh our local cache from HCM.
5. Manager sees the failure with a reason.

**Batch sync from HCM:**

HCM sends a full list of balances. For each one we update `hcmBalance` but leave `reservedDays` alone — because HCM doesn't know about our in-flight reservations. We write an audit log entry for each update.

---

## Tests

## Tests

We have three levels of tests — unit tests for pure logic, integration tests with a real SQLite database, and end-to-end tests that send real HTTP requests through the whole stack.

For HCM we run a small mock server during tests that behaves like a real HCM. We can tell it to return a 422, simulate a timeout, or go completely offline. This lets us test every failure path without touching a real HCM.

A few things that must always be true no matter what:
- `reservedDays` never goes negative
- A request is never approved when available days are less than requested
- Two requests with the same idempotency key result in only one record
- A batch sync never changes `reservedDays`

To run the tests:

```bash
npm test                # all tests
npm run test:unit       # unit tests only
npm run test:integration  # integration tests only
npm run test:e2e        # end-to-end tests only
```

To generate a coverage report:

```bash
npm run test:cov
```

This prints a summary in the terminal and also generates a full HTML report at `coverage/lcov-report/index.html`. Open it in a browser to see line-by-line coverage for every file.

Here is a sample report of the test coverage:-

<img width="1432" height="685" alt="Screenshot 2026-05-27 at 5 34 30 PM" src="https://github.com/user-attachments/assets/7a491069-68a2-4387-bc85-04e2d8e466e4" />


---

## Alternatives I considered

**Why not just call HCM on every read instead of keeping a local cache?**
Because that would make the UI's availability completely dependent on HCM's availability. If HCM is slow or down, employees can't even see their balance. The local cache keeps things fast and means a read never fails just because HCM is having a bad moment. We still call HCM live before every deduction, so we don't give up any correctness.

**Why keep sync_logs instead of doing full event sourcing?**
Event sourcing means you store every change as an immutable event and derive the current state by replaying them. It's a great audit trail but adds a lot of complexity — you need snapshot strategies, projection management, and reads get slower. The `sync_logs` table gives us the audit capability we need (what changed, when, and why) without any of that overhead.

**REST vs GraphQL?**
REST. The API is small and the operations are clear. GraphQL makes sense when clients need to pull complex nested data in different shapes — that's not what's happening here. Adding GraphQL would mean schema management, resolvers, and new security considerations for no real benefit.

**How does the UI know when an approval is done?**
When a manager approves we respond immediately with `HCM_SUBMITTING`, then finish talking to HCM in the background. The UI needs to know when it's done. For now the UI polls the request every 2–3 seconds until the status changes. HCM usually responds in under 5 seconds so this works fine.

The better long-term answer is Server-Sent Events — the server pushes a notification to the browser the moment the status changes, no polling needed. It works over a regular HTTP connection (unlike WebSockets which need a protocol upgrade) and is supported natively in all modern browsers. We'd do this once the frontend is ready. WebSockets would also work but they're designed for two-way communication — overkill when the server just needs to push one update.

## Codebase structure

```
src/
├── balance/              # Everything related to balances
│   ├── balance.controller.ts        # API endpoints (/balances)
│   ├── balance.service.ts           # Cache, reservations, batch sync logic
│   └── entities/balance.entity.ts  # The balances table
│
├── time-off-request/     # Everything related to requests
│   ├── time-off-request.controller.ts       # API endpoints (/time-off-requests)
│   ├── time-off-request.service.ts          # Approval flow, state machine
│   └── entities/time-off-request.entity.ts  # The requests table
│
├── hcm/                  # All outbound HCM calls
│   └── hcm.service.ts   # getBalance, deductBalance, restoreBalance + retry logic
│
├── sync/                 # Audit trail
│   ├── sync.service.ts            # getLogs query
│   └── entities/sync-log.entity.ts  # The sync_logs table
│
└── app.module.ts         # Wires everything together, DB config

test/
├── mock-hcm/     # Fake HCM server used in tests
├── unit/         # Pure logic tests, no DB or HTTP
├── integration/  # Tests with real SQLite + mock HCM
└── e2e/          # Full HTTP tests end to end
```

---

*End of document*
