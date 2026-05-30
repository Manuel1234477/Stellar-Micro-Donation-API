# Real-Time Donation Goal Tracking with Milestone Notifications and SSE Progress Updates

## Overview

This feature implements a complete real-time donation goal tracking system for campaigns. It provides:

- **Milestone Detection**: Automatically detects when donations reach 25%, 50%, 75%, and 100% of the campaign goal
- **Real-Time Progress Updates**: Server-Sent Events (SSE) stream for live progress updates to connected clients
- **Automated Lifecycle Management**: Automatic campaign closure and webhook notifications when goals are reached
- **Duplicate Prevention**: Ensures each milestone is notified only once using persistent tracking
- **Comprehensive Event System**: Event emissions for external system integration

## Architecture

### Database Schema

The campaigns table has been extended with milestone tracking columns:

```sql
ALTER TABLE campaigns ADD COLUMN notified_milestones TEXT DEFAULT '[]';
ALTER TABLE campaigns ADD COLUMN last_milestone_notification DATETIME;
ALTER TABLE campaigns ADD COLUMN closed_at DATETIME;
```

**Field Descriptions:**
- `notified_milestones` (JSON array): Tracks which milestones (0.25, 0.5, 0.75, 1.0) have already triggered notifications
- `last_milestone_notification` (timestamp): Records when the last milestone was notified
- `closed_at` (timestamp): Records when the campaign reached 100% and was closed

### Service Architecture

#### DonationService Enhancements

**New Methods:**

1. **`checkMilestones(totalRaised, goalAmount): number[]`**
   - Calculates which milestone thresholds have been reached
   - Returns array of milestone decimals (e.g., [0.25, 0.5])
   - Deterministic: same input always produces same output

   ```javascript
   const milestones = donationService.checkMilestones(500, 1000);
   // Returns [0.25, 0.5]
   ```

2. **`getNotifiedMilestones(campaign): number[]`**
   - Parses and retrieves the `notified_milestones` JSON array
   - Gracefully handles parsing errors or null values
   - Returns empty array if no milestones have been notified yet

   ```javascript
   const notified = donationService.getNotifiedMilestones(campaign);
   // Returns [0.25] if only 25% milestone has been notified
   ```

3. **`emitMilestoneEvents(campaignId, campaign, newMilestones)`**
   - Emits in-memory events for milestone reached
   - Integrates with SseManager for broadcast to connected clients
   - Logs milestone achievements
   - Returns EventEmitter for testing purposes

4. **`processCampaignContribution(campaignId, amount)`** (Enhanced)
   - Updates campaign `current_amount` atomically
   - Detects new milestones (those reached but not yet notified)
   - Updates `notified_milestones` in database
   - Dispatches webhooks for each new milestone
   - Closes campaign and sets status to "closed" when goal reached
   - Emits events for SSE streaming

## API Endpoints

### POST /api/campaigns

Create a new campaign with goal tracking enabled.

**Request:**
```bash
curl -X POST http://localhost:3000/api/campaigns \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Emergency Relief Fund",
    "description": "Disaster relief campaign",
    "goal_amount": 50000,
    "start_date": "2026-03-26T00:00:00Z",
    "end_date": "2026-04-26T00:00:00Z"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Emergency Relief Fund",
    "goal_amount": 50000,
    "current_amount": 0,
    "status": "active",
    "notified_milestones": "[]",
    "last_milestone_notification": null,
    "closed_at": null,
    "createdAt": "2026-03-26T10:30:00Z",
    "updatedAt": "2026-03-26T10:30:00Z"
  }
}
```

### GET /api/campaigns/:id/progress/stream

Establishes a Server-Sent Events connection for real-time campaign progress updates.

**Connection String:**
```javascript
const eventSource = new EventSource('/api/campaigns/1/progress/stream', {
  headers: {
    'X-API-Key': 'your-api-key'
  }
});
```

**Events Emitted:**

1. **Initial State** (on connection)
```javascript
{
  "event": "initial",
  "data": {
    "campaign_id": 1,
    "campaign_name": "Emergency Relief Fund",
    "goal_amount": 50000,
    "current_amount": 12500,
    "progress_percentage": 25,
    "status": "active",
    "timestamp": "2026-03-26T10:35:00Z"
  }
}
```

2. **Progress Update** (on each donation)
```javascript
{
  "event": "progress_update",
  "data": {
    "campaign_id": 1,
    "campaign_name": "Emergency Relief Fund",
    "goal_amount": 50000,
    "current_amount": 12500,
    "progress_percentage": 25,
    "status": "active",
    "timestamp": "2026-03-26T10:35:15Z"
  }
}
```

3. **Milestone Reached**
```javascript
{
  "event": "milestone_reached",
  "data": {
    "campaign_id": 1,
    "campaign_name": "Emergency Relief Fund",
    "milestone_percentage": 25,
    "current_amount": 12500,
    "goal_amount": 50000,
    "progress_percentage": 25,
    "timestamp": "2026-03-26T10:35:15Z"
  }
}
```

4. **Goal Reached**
```javascript
{
  "event": "goal_reached",
  "data": {
    "campaign_id": 1,
    "campaign_name": "Emergency Relief Fund",
    "goal_amount": 50000,
    "final_amount": 50000,
    "reached_at": "2026-03-26T10:40:00Z"
  }
}
```

**Client-Side Example:**
```javascript
const campaignId = 1;
const eventSource = new EventSource(`/api/campaigns/${campaignId}/progress/stream`, {
  headers: { 'X-API-Key': 'your-api-key' }
});

// Listen for progress updates
eventSource.addEventListener('progress_update', (event) => {
  const progress = JSON.parse(event.data);
  console.log(`Campaign progress: ${progress.progress_percentage}%`);
  updateProgressBar(progress.progress_percentage);
});

// Listen for milestones
eventSource.addEventListener('milestone_reached', (event) => {
  const milestone = JSON.parse(event.data);
  showNotification(`🎉 ${milestone.milestone_percentage}% milestone reached!`);
});

// Listen for goal reached
eventSource.addEventListener('goal_reached', (event) => {
  const data = JSON.parse(event.data);
  showSuccessMessage(`Goal reached! Campaign closed at ${data.final_amount}`);
  eventSource.close();
});

// Handle connection close
eventSource.addEventListener('close', () => {
  console.log('Campaign stream closed');
});

// Error handling
eventSource.addEventListener('error', () => {
  console.error('Connection error - attempting to reconnect in 5 seconds');
  eventSource.close();
  setTimeout(() => location.reload(), 5000);
});
```

### GET /api/campaigns/:id

Retrieve current campaign status including milestone tracking.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Emergency Relief Fund",
    "goal_amount": 50000,
    "current_amount": 25000,
    "notified_milestones": "[0.25, 0.5]",
    "last_milestone_notification": "2026-03-26T10:35:15Z",
    "closed_at": null,
    "status": "active"
  }
}
```

## Webhook Payload Structure

Webhooks are dispatched to subscribers when milestone and goal events occur.

### Milestone Webhook

**Event:** `campaign.milestone`

```json
{
  "campaign_id": 1,
  "name": "Emergency Relief Fund",
  "milestone_percentage": 25,
  "current_amount": 12500,
  "goal_amount": 50000,
  "progress_percentage": 25,
  "timestamp": "2026-03-26T10:35:15Z"
}
```

### Goal Reached Webhook

**Event:** `campaign.goal_reached`

```json
{
  "campaign_id": 1,
  "name": "Emergency Relief Fund",
  "goal_amount": 50000,
  "final_amount": 50000,
  "reached_at": "2026-03-26T10:40:00Z"
}
```

## Implementation Details

### Milestone Detection Logic

The system uses a deterministic percentage-based approach:

1. **Calculate Progress**: `progress = current_amount / goal_amount`
2. **Check Thresholds**: For each milestone (0.25, 0.5, 0.75, 1.0):
   - If `progress >= milestone`, the milestone has been reached
3. **Filter New**: Only milestones not in `notified_milestones` array are considered "new"
4. **Notify**: Emit events and dispatch webhooks for each new milestone
5. **Update Database**: Add new milestones to `notified_milestones` array

### Campaign Closure Logic

When a donation causes the campaign to reach 100%:

1. Campaign status changes from "active" to "closed"
2. `closed_at` timestamp is set to current time
3. Future donations to this campaign are ignored (only "active" campaigns accept donations)
4. `campaign.goal_reached` webhook is dispatched
5. Goal reached SSE event is broadcast to all connected clients

### Duplicate Prevention

The `notified_milestones` array ensures each milestone is only notified once:

- **Before Notification**: Check if milestone is already in `notified_milestones`
- **After Notification**: Add milestone to array and persist to database
- **On Reconnection**: New SSE clients receive current state (no retroactive milestone events)
- **Atomic Updates**: Database updates use atomic JSON operations

## Testing

### Running Tests

```bash
# Run all donation goal tracking tests
npm test -- implement-donation-goal-tracking-with-progress-not.test.js

# Run specific test suite
npm test -- implement-donation-goal-tracking-with-progress-not.test.js -t "Milestone Detection"

# Run with coverage
npm test -- implement-donation-goal-tracking-with-progress-not.test.js --coverage
```

### Test Coverage

The test suite covers:

1. **Milestone Detection** (7 tests)
   - 25%, 50%, 75%, 100% milestones
   - Exact boundary conditions
   - Over-reaching scenarios

2. **Notified Milestones Tracking** (4 tests)
   - JSON parsing
   - Null/empty handling
   - Error cases

3. **Campaign Contribution Processing** (7 tests)
   - Amount updates
   - Single notification per milestone
   - Campaign closure
   - Multiple milestone donations
   - Late arrivals on closed campaigns

4. **SSE Progress Stream** (6 tests)
   - Connection establishment
   - API key validation
   - Initial state transmission
   - Connection limits
   - Heartbeat mechanism

5. **Webhook Dispatch** (5 tests)
   - Milestone webhook dispatch
   - Goal reached webhook dispatch
   - Multiple milestone webhooks
   - Payload structure validation

6. **Edge Cases** (6 tests)
   - Zero goal handling
   - Small goals
   - Large goals
   - Fractional amounts
   - Rapid sequential donations

7. **Campaign Lifecycle** (3 tests)
   - Status transitions
   - Timestamp tracking
   - Closed campaign handling

8. **Progress Calculation** (3 tests)
   - Percentage accuracy
   - Over 100% handling
   - SSE data inclusion

### Edge Cases Handled

1. **Exact Milestone Hits**: Donation of exactly $12,500 for 50% of $25,000 goal
2. **Multi-Milestone Jumps**: Single $750 donation reaching 25%, 50%, 75% simultaneously
3. **Closed Campaigns**: Late arrivals rejected (unchanged current_amount)
4. **Zero Goal**: Graceful handling (returns Infinity, no crashes)
5. **Fractional Amounts**: Precise handling of decimal values
6. **Rapid Donations**: Sequential donations correctly accumulate milestones
7. **Connection Limits**: Per-API-key enforcement of max SSE connections

## Database Migration

To add milestone tracking to existing database:

```bash
npm run migrate:campaign-milestones
# or manually run:
node src/scripts/migrations/003_add_campaign_milestone_tracking.js
```

The migration script safely handles:
- Existing campaigns (adds columns with defaults)
- Null values (converts to '[]' for JSON arrays)
- Backwards compatibility (no data loss)

## Performance Considerations

### Database Performance
- **Indexed Queries**: Campaign lookups use primary key index
- **Atomic Updates**: JSON updates are atomic at database level
- **Minimal Reads**: Single read-then-update pattern to check milestones

### SSE Performance
- **Heartbeat**: 30-second heartbeat prevents connection stalling
- **Event Buffering**: Last 500 events buffered for reconnection support
- **Per-Key Limits**: Max 5 connections per API key to prevent abuse
- **Lazy Initialization**: Filters only checked when broadcasting

### Scalability
- **Stateless**: No in-memory state of campaigns (all state in DB)
- **Event-Driven**: Webhooks are fire-and-forget with exponential backoff
- **Horizontal**: Multiple server instances can process donations independently

## Security Considerations

1. **API Key Validation**: SSE endpoint requires valid API key
2. **Connection Limits**: Per-API-key rate limiting (max 5 concurrent connections)
3. **Input Validation**: Campaign IDs validated before stream creation
4. **Error Isolation**: Service errors don't expose internal details
5. **Webhook Signing**: Webhooks include HMAC-SHA256 signature verification

## Troubleshooting

### Milestones Not Triggering

**Issue**: Donations are received but milestones don't trigger

**Diagnosis**:
```sql
SELECT * FROM campaigns WHERE id = 1;
-- Check: notified_milestones, current_amount, goal_amount
```

**Solutions**:
1. Verify `goal_amount` is set correctly
2. Check `current_amount` reflects donations
3. Inspect `notified_milestones` JSON array for existing entries
4. Review logs for `CAMPAIGN` entries

### SSE Connection Drops

**Issue**: Real-time updates stop arriving

**Causes**:
- Network timeout (client-side)
- Too many connections (server returns 429)
- Proxy buffering (add `X-Accel-Buffering: no` header)

**Solutions**:
1. Implement client-side reconnection logic
2. Check API key usage across multiple tabs/windows
3. Configure reverse proxy to disable buffering

### Webhook Delivery Failures

**Issue**: Webhooks not reaching subscriber endpoints

**Diagnosis**:
```sql
SELECT * FROM webhooks WHERE campaign_id = 1;
-- Check: is_active, consecutive_failures
```

**Solutions**:
1. Verify webhook URL is publicly accessible
2. Check webhook is marked `is_active = 1`
3. Review webhook logs for timeout/connection errors
4. Ensure signature verification is implemented

## Examples

### Complete Frontend Example (React)

```javascript
import React, { useEffect, useState } from 'react';

function CampaignProgress({ campaignId, apiKey }) {
  const [progress, setProgress] = useState(0);
  const [milestones, setMilestones] = useState([]);
  const [status, setStatus] = useState('connecting');
  const [campaignData, setCampaignData] = useState(null);

  useEffect(() => {
    const eventSource = new EventSource(
      `/api/campaigns/${campaignId}/progress/stream`,
      { headers: { 'X-API-Key': apiKey } }
    );

    eventSource.addEventListener('open', () => {
      setStatus('connected');
    });

    eventSource.addEventListener('progress_update', (event) => {
      const data = JSON.parse(event.data);
      setProgress(data.progress_percentage);
      setCampaignData(data);
    });

    eventSource.addEventListener('milestone_reached', (event) => {
      const data = JSON.parse(event.data);
      setMilestones(prev => [...new Set([...prev, data.milestone_percentage])]);
      showNotification(`${data.milestone_percentage}% reached!`);
    });

    eventSource.addEventListener('goal_reached', (event) => {
      setStatus('completed');
      eventSource.close();
    });

    eventSource.addEventListener('error', () => {
      setStatus('error');
    });

    return () => eventSource.close();
  }, [campaignId, apiKey]);

  return (
    <div className="campaign-progress">
      <h2>{campaignData?.campaign_name}</h2>
      <div className="progress-bar">
        <div style={{ width: `${progress}%` }}>{progress}%</div>
      </div>
      <p>{campaignData?.current_amount} / {campaignData?.goal_amount}</p>
      {milestones.map(m => (
        <span key={m} className="milestone">🎉 {m}%</span>
      ))}
      <p className="status">{status}</p>
    </div>
  );
}

export default CampaignProgress;
```

### Backend Webhook Subscriber Example

```javascript
// Express endpoint to receive campaign milestones
app.post('/webhooks/campaign-milestones', (req, res) => {
  const crypto = require('crypto');
  
  // Verify signature
  const signature = req.headers['x-webhook-signature'];
  const body = req.rawBody;
  const expectedSig = crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(body)
    .digest('hex');
    
  if (signature !== `sha256=${expectedSig}`) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { event, data } = req.body;

  if (event === 'campaign.milestone') {
    console.log(`Milestone: ${data.milestone_percentage}% of campaign ${data.campaign_id}`);
    // Send email notification, update dashboard, etc.
  } else if (event === 'campaign.goal_reached') {
    console.log(`Campaign ${data.campaign_id} fully funded!`);
    // Trigger completion workflow
  }

  res.json({ success: true });
});
```

## Related Documentation

- [Campaign Management API](./campaigns.md)
- [Webhook System](./webhooks.md)
- [SSE Implementation](./stream.md)
- [Testing Guide](./testing.md)
