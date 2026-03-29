# Recurring Donation Pause & Resume

## Overview

Donors can temporarily pause active recurring donation schedules and resume them later without losing their configuration. Paused schedules are skipped by the scheduler and clearly indicate their paused state in all responses.

## Endpoints

### Pause a Schedule

```
POST /stream/schedules/:id/pause
```

Pauses an active recurring donation schedule immediately.

**Permissions:** `stream:update`

**Responses:**
- `200` – Schedule paused successfully
- `400` – Schedule is not active (e.g. cancelled)
- `404` – Schedule not found
- `409` – Schedule is already paused

**Example response:**
```json
{
  "success": true,
  "message": "Recurring donation schedule paused successfully",
  "data": {
    "id": 42,
    "status": "paused",
    "pausedAt": "2026-03-28T15:00:00.000Z"
  }
}
```

---

### Resume a Schedule

```
POST /stream/schedules/:id/resume
```

Resumes a paused schedule. The `nextExecutionDate` is recalculated from the current time based on the schedule's frequency.

**Permissions:** `stream:update`

**Responses:**
- `200` – Schedule resumed successfully
- `400` – Schedule is not paused
- `404` – Schedule not found

**Example response:**
```json
{
  "success": true,
  "message": "Recurring donation schedule resumed successfully",
  "data": {
    "id": 42,
    "status": "active",
    "resumedAt": "2026-03-28T16:00:00.000Z",
    "nextExecutionDate": "2026-04-04T16:00:00.000Z"
  }
}
```

---

### Filter Schedules by Status

```
GET /stream/schedules?status=paused
```

Returns only schedules matching the given status. Supported values: `active`, `paused`, `cancelled`, `completed`.

**Example:**
```
GET /stream/schedules?status=paused
```

---

## Schedule Object Fields

| Field | Type | Description |
|-------|------|-------------|
| `pausedAt` | ISO datetime \| null | When the schedule was last paused |
| `resumedAt` | ISO datetime \| null | When the schedule was last resumed |
| `status` | string | `active`, `paused`, `cancelled`, or `completed` |

---

## Scheduler Behaviour

The `RecurringDonationScheduler` queries only `status = 'active'` schedules. Paused schedules are **never executed** — they are simply skipped without being cancelled or modified.

---

## Database Migration

Migration `008_add_pause_resume_to_recurring_donations.js` adds:
- `pausedAt DATETIME` — timestamp of last pause
- `resumedAt DATETIME` — timestamp of last resume

---

## Error Codes

| HTTP | Condition |
|------|-----------|
| 409 | Pausing an already-paused schedule |
| 400 | Resuming a non-paused schedule |
| 400 | Pausing a cancelled/completed schedule |
