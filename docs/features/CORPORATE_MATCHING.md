# Corporate Donation Matching

## Overview

Corporate donation matching allows companies to automatically match employee donations up to configured limits. The system supports per-employee annual limits and corporate total limits, ensuring atomic enforcement of all constraints.

## Features

- **Per-Employee Annual Limits**: Each employee has an annual matching limit (e.g., $100/year)
- **Corporate Total Limits**: Overall corporate matching budget
- **Automatic Matching**: Donations are matched immediately upon creation
- **Multiple Programs**: Companies can run multiple matching programs
- **Employee Enrollment**: Employees opt-in to corporate matching programs
- **Atomic Enforcement**: All limits are enforced atomically to prevent overspending

## API Endpoints

### Admin Endpoints

#### Create Corporate Matching Program
```http
POST /admin/corporate-matching
Authorization: Bearer <admin-api-key>
Content-Type: application/json

{
  "sponsor_id": 123,
  "match_ratio": 1.0,
  "per_employee_limit": 100.0,
  "total_limit": 10000.0
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "sponsor_id": 123,
    "match_ratio": 1.0,
    "per_employee_limit": 100.0,
    "total_limit": 10000.0,
    "remaining_total_limit": 10000.0,
    "status": "active",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

#### List Corporate Matching Programs
```http
GET /admin/corporate-matching
Authorization: Bearer <admin-api-key>
```

#### Get Program Details
```http
GET /admin/corporate-matching/:id
Authorization: Bearer <admin-api-key>
```

#### Update Program Status
```http
PATCH /admin/corporate-matching/:id/status
Authorization: Bearer <admin-api-key>
Content-Type: application/json

{
  "status": "paused"
}
```

#### Get Enrolled Employees
```http
GET /admin/corporate-matching/:id/employees
Authorization: Bearer <admin-api-key>
```

### Public Endpoints

#### Enroll in Corporate Matching Program
```http
POST /corporate-matching/:id/enroll
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "employee_wallet_id": 456
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "corporate_matching_id": 1,
    "employee_wallet_id": 456,
    "enrolled_at": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Get Program Info (Public)
```http
GET /corporate-matching/:id
Authorization: Bearer <api-key>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "match_ratio": 1.0,
    "per_employee_limit": 100.0,
    "status": "active",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

## How It Works

### 1. Program Creation
Administrators create corporate matching programs with:
- **Sponsor**: The company wallet that funds the matching
- **Match Ratio**: How much to match (1.0 = 1:1, 0.5 = 50%)
- **Per-Employee Limit**: Annual limit per employee
- **Total Limit**: Overall corporate budget

### 2. Employee Enrollment
Employees enroll in matching programs they want to participate in.

### 3. Automatic Matching
When an enrolled employee makes a donation:
1. System checks if employee is enrolled in active programs
2. Calculates potential match amount (donation × ratio)
3. Checks per-employee annual limit remaining
4. Checks corporate total limit remaining
5. Creates matching donation with the minimum of all constraints
6. Updates tracking records atomically

### 4. Limit Enforcement
- **Per-Employee**: Tracked per calendar year
- **Corporate Total**: Applies across all employees
- **Atomic**: All checks happen in database transactions

## Database Schema

### corporate_matching
```sql
CREATE TABLE corporate_matching (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sponsor_id INTEGER NOT NULL,
  match_ratio REAL NOT NULL DEFAULT 1.0,
  per_employee_limit REAL NOT NULL,
  total_limit REAL NOT NULL,
  remaining_total_limit REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sponsor_id) REFERENCES users(id)
);
```

### matching_employees
```sql
CREATE TABLE matching_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  corporate_matching_id INTEGER NOT NULL,
  employee_wallet_id INTEGER NOT NULL,
  enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (corporate_matching_id) REFERENCES corporate_matching(id),
  FOREIGN KEY (employee_wallet_id) REFERENCES users(id),
  UNIQUE(corporate_matching_id, employee_wallet_id)
);
```

### employee_matching_history
```sql
CREATE TABLE employee_matching_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  corporate_matching_id INTEGER NOT NULL,
  employee_wallet_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  matched_amount REAL NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (corporate_matching_id) REFERENCES corporate_matching(id),
  FOREIGN KEY (employee_wallet_id) REFERENCES users(id),
  UNIQUE(corporate_matching_id, employee_wallet_id, year)
);
```

### corporate_matching_donations
```sql
CREATE TABLE corporate_matching_donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  corporate_matching_id INTEGER NOT NULL,
  original_donation_id INTEGER NOT NULL,
  employee_wallet_id INTEGER NOT NULL,
  matched_amount REAL NOT NULL,
  year INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (corporate_matching_id) REFERENCES corporate_matching(id),
  FOREIGN KEY (original_donation_id) REFERENCES transactions(id),
  FOREIGN KEY (employee_wallet_id) REFERENCES users(id)
);
```

## Security Considerations

### Atomicity
All limit checks and updates happen within database transactions to prevent race conditions and overspending.

### Authorization
- Program creation requires admin privileges
- Employee enrollment requires valid API key
- Public endpoints only expose non-sensitive information

### Validation
- All monetary amounts validated as positive numbers
- Match ratios constrained to reasonable ranges (0.01 - 10.0)
- Foreign key constraints ensure data integrity

## Examples

### Complete Flow

1. **Create Program:**
```bash
curl -X POST /admin/corporate-matching \
  -H "Authorization: Bearer admin_key" \
  -H "Content-Type: application/json" \
  -d '{
    "sponsor_id": 123,
    "match_ratio": 1.0,
    "per_employee_limit": 100.0,
    "total_limit": 5000.0
  }'
```

2. **Employee Enrolls:**
```bash
curl -X POST /corporate-matching/1/enroll \
  -H "Authorization: Bearer employee_key" \
  -H "Content-Type: application/json" \
  -d '{
    "employee_wallet_id": 456
  }'
```

3. **Employee Donates:**
```bash
curl -X POST /donations \
  -H "Authorization: Bearer employee_key" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 50,
    "recipient": "G...",
    "memo": "Charity donation"
  }'
```

4. **Automatic Matching:**
- System creates $50 matching donation from corporate sponsor
- Employee's annual matched amount becomes $50
- Corporate remaining total becomes $4950

## Error Handling

### Validation Errors
- `sponsor_id` must be valid user ID
- `match_ratio` must be between 0.01 and 10.0
- `per_employee_limit` and `total_limit` must be positive

### Business Logic Errors
- Employee already enrolled in program
- Program is not active
- Corporate total limit exhausted
- Employee annual limit exhausted

### Atomicity Guarantees
- Database transactions ensure limits are never exceeded
- Failed matches are logged but don't prevent donations
- Webhook notifications sent when programs exhaust

## Monitoring

### Metrics
- Total matched amounts by program
- Employee participation rates
- Program exhaustion events
- Matching ratio utilization

### Logs
- Program creation/update events
- Employee enrollment events
- Matching donation creation
- Limit exhaustion events

### Webhooks
Programs can receive webhook notifications when:
- Program is exhausted
- High utilization thresholds reached
- Employee enrollment occurs