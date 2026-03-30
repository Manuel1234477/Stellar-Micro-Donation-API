# API Flow Diagrams

## One-Time Donation Flow

```mermaid
sequenceDiagram
    participant Client
    participant API as Express API
    participant Service as Stellar Service
    participant Horizon as Horizon API
    participant Stellar as Stellar Network
    participant DB as SQLite Database

    Client->>API: POST /donations
    API->>API: Validate request
    API->>Service: Create donation
    Service->>Horizon: Submit transaction
    Horizon->>Stellar: Process on blockchain
    Stellar-->>Horizon: Transaction confirmed
    Horizon-->>Service: Transaction result
    Service->>DB: Record transaction
    DB-->>Service: Success
    Service-->>API: Transaction details
    API-->>Client: 201 Created (transaction ID)
```

## Recurring Donation Creation Flow

```mermaid
sequenceDiagram
    participant Client
    participant API as Express API
    participant DB as SQLite Database
    participant Scheduler as Recurring Scheduler

    Client->>API: POST /stream/create
    API->>API: Validate request
    API->>DB: Check donor exists
    DB-->>API: Donor found
    API->>DB: Check recipient exists
    DB-->>API: Recipient found
    API->>API: Calculate next execution date
    API->>DB: Insert schedule
    DB-->>API: Schedule created (ID)
    API-->>Client: 201 Created (schedule details)
    
    Note over Scheduler: Runs every 60 seconds
    Scheduler->>DB: Query due schedules
    DB-->>Scheduler: List of due schedules
    Scheduler->>Scheduler: Execute each donation
    Scheduler->>DB: Record transaction
    Scheduler->>DB: Update schedule
```

## Wallet Transaction Query Flow

```mermaid
sequenceDiagram
    participant Client
    participant API as Express API
    participant DB as SQLite Database

    Client->>API: GET /wallets/:publicKey/transactions
    API->>DB: Query user by publicKey
    DB-->>API: User data
    
    alt User found
        API->>DB: Query transactions (sent + received)
        DB-->>API: Transaction list
        API->>API: Format response
        API-->>Client: 200 OK (transactions)
    else User not found
        API-->>Client: 200 OK (empty array)
    end
```

## Recurring Donation Execution Flow

```mermaid
flowchart TD
    Start([Scheduler Timer: Every 60s]) --> Query[Query DB for due schedules]
    Query --> Check{Any due<br/>schedules?}
    
    Check -->|No| Wait[Wait for next cycle]
    Wait --> Start
    
    Check -->|Yes| Loop[For each schedule]
    Loop --> Execute[Execute donation via<br/>Stellar Service]
    Execute --> Record[Record transaction in DB]
    Record --> CalcNext[Calculate next<br/>execution date]
    CalcNext --> Update[Update schedule:<br/>- lastExecutionDate<br/>- nextExecutionDate<br/>- executionCount++]
    Update --> More{More<br/>schedules?}
    
    More -->|Yes| Loop
    More -->|No| Wait
    
    style Start fill:#e1f5ff
    style Execute fill:#fff4e1
    style Record fill:#e8f5e9
    style Update fill:#f3e5f5
```

## Error Handling Flow

```mermaid
flowchart TD
    Request[API Request] --> Validate{Valid<br/>Input?}
    
    Validate -->|No| Error400[400 Bad Request]
    Validate -->|Yes| Auth{Authorized?}
    
    Auth -->|No| Error401[401 Unauthorized]
    Auth -->|Yes| Process[Process Request]
    
    Process --> DBOp{Database<br/>Operation}
    DBOp -->|Error| Error500[500 Internal Server Error]
    DBOp -->|Success| StellarOp{Stellar<br/>Operation?}
    
    StellarOp -->|No| Success[200/201 Success]
    StellarOp -->|Yes| Stellar{Stellar<br/>Success?}
    
    Stellar -->|Error| Error500
    Stellar -->|Success| Success
    
    Error400 --> LogError[Log Error]
    Error401 --> LogError
    Error500 --> LogError
    LogError --> Return[Return Error Response]
    
    Success --> LogSuccess[Log Success]
    LogSuccess --> ReturnSuccess[Return Success Response]
    
    style Error400 fill:#ffebee
    style Error401 fill:#ffebee
    style Error500 fill:#ffebee
    style Success fill:#e8f5e9
```

## System Startup Flow

```mermaid
flowchart TD
    Start([npm start]) --> LoadEnv[Load Environment Variables]
    LoadEnv --> InitExpress[Initialize Express App]
    InitExpress --> LoadMiddleware[Load Middleware:<br/>- JSON parser<br/>- Logger<br/>- Error handler]
    LoadMiddleware --> RegisterRoutes[Register Routes:<br/>- /donations<br/>- /wallets<br/>- /stream<br/>- /stats]
    RegisterRoutes --> ConnectDB{Database<br/>Exists?}
    
    ConnectDB -->|No| CreateDB[Run initDB.js]
    CreateDB --> ConnectDB
    
    ConnectDB -->|Yes| StartServer[Start HTTP Server<br/>Port 3000]
    StartServer --> StartScheduler[Start Recurring<br/>Donation Scheduler]
    StartScheduler --> Ready([API Ready])
    
    style Start fill:#e1f5ff
    style Ready fill:#e8f5e9
    style StartScheduler fill:#fff9c4
```

## Database Initialization Flow

```mermaid
flowchart TD
    Start([npm run init-db]) --> CheckDir{Data directory<br/>exists?}
    
    CheckDir -->|No| CreateDir[Create data/ directory]
    CreateDir --> CheckDB
    
    CheckDir -->|Yes| CheckDB{Database<br/>exists?}
    
    CheckDB -->|Yes| Skip[Skip - Already initialized]
    Skip --> End
    
    CheckDB -->|No| CreateDB[Create stellar_donations.db]
    CreateDB --> CreateUsers[Create users table]
    CreateUsers --> CreateTx[Create transactions table]
    CreateTx --> CreateRecurring[Create recurring_donations table]
    CreateRecurring --> InsertSample[Insert sample data]
    InsertSample --> Verify[Verify tables created]
    Verify --> Success([✓ Initialization Complete])
    
    style Start fill:#e1f5ff
    style Success fill:#e8f5e9
    style Skip fill:#fff9c4
```

## Request/Response Lifecycle

```mermaid
flowchart LR
    Client[Client Request] --> Middleware1[Logger Middleware]
    Middleware1 --> Middleware2[JSON Parser]
    Middleware2 --> Router[Express Router]
    Router --> Route{Route<br/>Match?}
    
    Route -->|No| NotFound[404 Handler]
    Route -->|Yes| Handler[Route Handler]
    
    Handler --> Service[Service Layer]
    Service --> DB[(Database)]
    Service --> Stellar[Stellar Network]
    
    DB --> Response[Build Response]
    Stellar --> Response
    
    Response --> ErrorCheck{Error?}
    ErrorCheck -->|Yes| ErrorHandler[Error Handler]
    ErrorCheck -->|No| Success[Success Response]
    
    ErrorHandler --> Client
    Success --> Client
    NotFound --> Client
    
    style Client fill:#e1f5ff
    style Success fill:#e8f5e9
    style ErrorHandler fill:#ffebee
    style NotFound fill:#ffebee
```
