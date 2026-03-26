# Donation Campaign Management

## Overview
This feature incorporates comprehensive donation pooling via natively mapped API campaigns tracking metrics securely alongside normal transfers.

## Architecture

### Native Endpoints (`/campaigns`)
- **[POST] `/campaigns`**: Generate campaign properties defining logical scopes (`name, description, goal_amount, start_date, end_date`).
- **[GET] `/campaigns`**: Scan through paginated properties inspecting active objects automatically closing ones natively past deadlines logically.
- **[GET] `/campaigns/:id`**: Query an individual campaign.
- **[PATCH] `/campaigns/:id`**: Modify metrics or abruptly manipulate endpoints defining status overrides (`active, paused, completed, cancelled`).
- **[GET] `/campaigns/:id/donations`**: Map inherently into historic transfers returning attached `transactions` rows natively filtered securely.

### Integration (Donation Codec Hooks)
Traditional endpoints spanning `/donations/send` & `/donations` support a natively unblocked integer injection array defined strictly as `campaign_id`. When routed, properties dynamically locate attached campaign properties, accumulating `current_amount` sequentially towards metrics efficiently natively prior to yielding the JSON result structures. 

### Automated Webhooks logic
Once properties hit logical thresholds (e.g `current_amount >= goal_amount`), internal hooks directly instruct SQLite to finalize parameters mapping internally into `status = completed`, dynamically queuing deterministic payloads directly inside `WebhookService` dispatch endpoints firing deterministically onto `campaign.completed` subscriptions natively securely immediately. 

> *Note: Historic transfers missing this flag default into normal scopes.*
