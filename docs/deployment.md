# Deployment Guide

## Environment Variables

All required configuration is via environment variables. See `RUNTIME_ASSUMPTIONS.md` for the full reference.

**Required for production:**

```env
NODE_ENV=production
PORT=3000
STELLAR_NETWORK=mainnet
HORIZON_URL=https://horizon.stellar.org
ENCRYPTION_KEY=<32-byte hex string>
API_KEYS=<comma-separated keys, or use database-backed keys>
```

**Optional:**

```env
MOCK_STELLAR=false
DEBUG_MODE=false
LOG_VERBOSE=false
```

Generate a secure `ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Bare Metal / VPS

```bash
# 1. Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Clone and install
git clone https://github.com/Manuel1234477/Stellar-Micro-Donation-API.git
cd Stellar-Micro-Donation-API
npm ci --omit=dev

# 3. Configure
cp .env.example .env
# Edit .env with production values

# 4. Initialize database
npm run init-db

# 5. Run with PM2 (process manager)
npm install -g pm2
pm2 start src/routes/app.js --name stellar-api
pm2 save
pm2 startup
```

The SQLite database is stored at `data/stellar_donations.db`. Back this up regularly.

---

## Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run init-db
EXPOSE 3000
CMD ["node", "src/routes/app.js"]
```

```bash
docker build -t stellar-api .
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  --env-file .env \
  --name stellar-api \
  stellar-api
```

Mount `/app/data` as a volume to persist the SQLite database across container restarts.

---

## Cloud (AWS / GCP / Azure)

### AWS Elastic Beanstalk

1. Install the EB CLI: `pip install awsebcli`
2. `eb init` — select Node.js platform
3. Add environment variables via the EB console or `eb setenv KEY=VALUE`
4. `eb create stellar-api-prod`

Mount an EFS volume at `/app/data` for persistent SQLite storage, or migrate to RDS PostgreSQL for production scale.

### Docker-based (ECS, Cloud Run, Azure Container Apps)

Use the Dockerfile above. Pass environment variables via the platform's secrets/env management. Mount persistent storage for `/app/data`.

---

## Production Checklist

- [ ] `NODE_ENV=production`
- [ ] `MOCK_STELLAR=false`
- [ ] `STELLAR_NETWORK=mainnet`
- [ ] `ENCRYPTION_KEY` set to a secure random value
- [ ] API keys created via `npm run keys:create`
- [ ] Database file backed up (or on persistent volume)
- [ ] HTTPS termination at load balancer / reverse proxy
- [ ] Health check configured: `GET /health`
- [ ] Log aggregation set up
- [ ] Rate limiting reviewed for expected traffic

See [Pre-Deployment Checklist](./guides/PRE_DEPLOYMENT_CHECKLIST.md) for the full verification list.

---

## Health Check

```bash
curl https://your-domain.com/health
# → { "status": "ok" }
```

Use this endpoint for load balancer health checks and uptime monitoring.

## Graceful Shutdown

The server handles `SIGTERM` and `SIGINT` by:
1. Stopping the recurring donation scheduler
2. Waiting for in-flight requests to complete
3. Closing the database connection

Kubernetes/ECS will send `SIGTERM` before killing the container — the default 30-second grace period is sufficient.
