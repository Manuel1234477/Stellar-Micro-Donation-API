# Production Deployment Guide

This document provides comprehensive guidance for deploying the Stellar Micro Donation API to production environments.

## Overview

The production deployment uses Docker Compose with secure configurations that:
- Handle secrets securely using Docker Secrets
- Apply resource limits to prevent container exhaustion
- Implement restart policies for high availability
- Configure health checks and monitoring
- Use proper logging configurations

## Quick Start

### 1. Prepare Secrets Directory

Create the secrets directory and populate it with your production credentials:

```bash
mkdir -p secrets
```

### 2. Generate or Provide Secrets

You need the following secrets:

```bash
# Encryption key (64-character hex)
openssl rand -hex 32 > secrets/encryption_key.txt

# Generate API keys for your production environment
echo "prod_key_1,prod_key_2,prod_key_3" > secrets/api_keys.txt

# Database encryption key (64-character hex)
openssl rand -hex 32 > secrets/db_encryption_key.txt

# Stellar keypair (from your Stellar account)
echo "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" > secrets/stellar_secret_key.txt
echo "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" > secrets/stellar_public_key.txt

# JWT secret for token signing (64-character hex)
openssl rand -hex 32 > secrets/jwt_secret.txt
```

**IMPORTANT:** 
- Never commit secret files to version control
- Rotate secrets regularly using the API key rotation procedure
- Use a secure secret management system (e.g., HashiCorp Vault, AWS Secrets Manager)

### 3. Deploy with Docker Compose

> **Note:** The commands below use plain `docker-compose up`.  In this
> mode the `deploy.resources` block in `docker-compose.prod.yml` is
> silently ignored by Docker Compose — resource limits and reservations
> are **not** enforced.  For guaranteed resource enforcement, either use
> Docker Swarm (`docker stack deploy`) or add `mem_limit` / `cpus` keys
> directly to the service.  See the [Resource Configuration](#resource-configuration)
> section for details.

```bash
# Start the production deployment
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f api
```

### 4. Verify Deployment

```bash
# Check health endpoint
curl http://localhost:3000/health

# Run smoke tests against production
npm run test:smoke
```

## Environment Variables

The production deployment uses file-based secret injection. Configure these environment variables:

| Variable | Purpose | Example |
|----------|---------|---------|
| `ENCRYPTION_KEY_FILE` | Path to encryption key secret | `/run/secrets/encryption_key` |
| `API_KEYS_FILE` | Path to API keys secret | `/run/secrets/api_keys` |
| `DB_ENCRYPTION_KEY_FILE` | Path to database encryption key | `/run/secrets/db_encryption_key` |
| `STELLAR_SECRET_KEY_FILE` | Path to Stellar secret key | `/run/secrets/stellar_secret_key` |
| `STELLAR_PUBLIC_KEY_FILE` | Path to Stellar public key | `/run/secrets/stellar_public_key` |
| `JWT_SECRET_FILE` | Path to JWT signing secret | `/run/secrets/jwt_secret` |
| `NODE_ENV` | Environment mode | `production` |
| `DB_PATH` | SQLite database location | `/app/data/donations.db` |
| `LOG_LEVEL` | Logging level | `info`, `debug`, `error` |
| `SECURE_SECRETS` | Enable secure secret file handling | `true` |
| `SHUTDOWN_TIMEOUT_MS` | Graceful-shutdown budget in milliseconds | `30000` |

## Resource Configuration

The production docker-compose applies the following resource limits:

> **⚠️ Swarm-only caveat — read before deploying**
>
> The `deploy.resources` block in `docker-compose.prod.yml` is a
> **Docker Swarm / Docker Stack construct**.  When you deploy with plain
> `docker-compose up`, Docker Compose silently ignores the entire
> `deploy.resources` block — neither the limits *nor* the reservations
> below are applied to the container.  Resource guarantees in that
> scenario are entirely up to the host OS and Docker daemon defaults.
>
> | Deployment command | `deploy.resources` honoured? |
> |--------------------|------------------------------|
> | `docker-compose -f docker-compose.prod.yml up -d` | ❌ ignored |
> | `docker stack deploy -c docker-compose.prod.yml stellar` | ✅ enforced |
>
> **Plain `docker-compose up` users:** add top-level `mem_limit` /
> `cpus` keys directly under the service to get container-level resource
> enforcement:
>
> ```yaml
> services:
>   api:
>     mem_limit: 1g
>     cpus: '2.0'
>     # ... rest of the service definition
> ```

### CPU
- **Limit**: 2 CPUs max
- **Reservation/request**: 1 CPU (Swarm scheduler hint only)

### Memory
- **Limit**: 1 GB max
- **Reservation/request**: 512 MB (Swarm scheduler hint only)

Adjust these values based on your expected traffic and infrastructure.

An initial local process-level resource observation using the existing load suite with 10
concurrent users and 50 iterations per scenario reached approximately one CPU
core and 151 MiB maximum resident memory. The recommended 1 CPU / 512 MiB
request and 2 CPU / 1 GiB limit provide scheduling capacity and burst
headroom above that observation. Because the donation-creation scenario had a
separate functional baseline failure during this run, operators should repeat
the profile with healthy production-like traffic before reducing these values.

```yaml
# Swarm-only — ignored by plain docker-compose up (see caveat above)
deploy:
  resources:
    limits:
      cpus: '2.0'       # Adjust based on traffic
      memory: 1G        # Adjust based on data size
    reservations:
      cpus: '1.0'       # Swarm scheduler hint
      memory: 512M      # Swarm scheduler hint
```

## Graceful Container Termination

The application uses `SHUTDOWN_TIMEOUT_MS=30000`, giving it 30 seconds to drain in-flight requests after `SIGTERM`. The production Compose service sets `stop_grace_period: 35s`, providing a five-second buffer before Docker sends `SIGKILL`.

The container grace period must be greater than or equal to the application shutdown budget.

## Restart Policy

The production deployment uses `restart: always`, which means:
- Container automatically restarts if it crashes
- Container restarts after daemon restart
- Respects a restart delay for failing services

For Swarm/Kubernetes deployments, adjust the restart policy in your orchestration configuration.

## Health Checks

Health checks run every 30 seconds:
- **Endpoint**: `GET /health`
- **Timeout**: 5 seconds
- **Retries**: 3 consecutive failures mark unhealthy
- **Startup Grace**: 15 seconds before first check

The health check endpoint verifies:
- Database connectivity
- API responsiveness
- Essential service availability

## Logging

Logs are configured with JSON driver:
- **Max size**: 100 MB per log file
- **Max files**: 10 rotated logs
- **Labels**: Automatically tagged with service and environment

Logs are mounted to the `logs` volume for external log aggregation. Configure your logging infrastructure to consume logs from:
```
/app/logs/
```

## Volumes

### Database Volume (`db_data`)
- Persists SQLite database across restarts
- Location: `/app/data/donations.db`
- Survives container termination

### Logs Volume (`logs`)
- Collects application logs
- Location: `/app/logs/`
- Should be regularly backed up or streamed to log aggregation service

## Security Considerations

### 1. Secret Management

**Best Practices:**
- Use Docker Swarm secrets or Kubernetes secrets in orchestrated environments
- Consider external secret management (Vault, AWS Secrets Manager, etc.)
- Implement secret rotation regularly
- Never expose secrets in logs

**File-based Secrets:**
- Secrets are mounted read-only
- Only accessible to the container process
- Permissions: `0440` (user-readable, group-readable)

### 2. Network Security

- Bind API to `localhost` internally, expose via reverse proxy/load balancer
- Use TLS/SSL for all external connections
- Implement rate limiting on public endpoints
- Use API key authentication for all requests

### 3. Database Security

- Keep database file on encrypted volumes
- Regular automated backups with verification
- Use database-level encryption where possible
- Monitor for unauthorized access

### 4. Container Security

- Use minimal base image (Node.js Alpine)
- Run as non-root user where possible
- Regularly update base image and dependencies
- Scan images for vulnerabilities

## Backup and Disaster Recovery

### Backup Strategy

Regular automated backups should:
1. Back up the SQLite database file (`/app/data/donations.db`)
2. Back up configuration and secrets (in secure location)
3. Retain backups for minimum 30 days
4. Test restore procedures regularly

### Backup Commands

```bash
# Manual backup
docker-compose -f docker-compose.prod.yml exec api tar czf - /app/data > backup-$(date +%Y%m%d).tar.gz

# Restore from backup
docker-compose -f docker-compose.prod.yml down
tar xzf backup-20240724.tar.gz
docker-compose -f docker-compose.prod.yml up -d
```

### Automated Backup

Use cron or Docker container for regular backups:

```bash
# Add to crontab for daily backups at 2 AM
0 2 * * * cd /path/to/api && docker-compose -f docker-compose.prod.yml exec -T api tar czf - /app/data | gzip > /backups/stellar-api-$(date +\%Y\%m\%d).tar.gz
```

## Monitoring and Observability

### Metrics

Monitor these key metrics:
- **Container CPU**: Should stay below 60% of limit
- **Container Memory**: Should stay below 80% of limit
- **Database Size**: Track growth over time
- **API Response Time**: P99 latency
- **Error Rate**: 4xx/5xx response rate

### Alerting

Set up alerts for:
- Container restart rate > 5 per hour
- Memory usage > 90%
- Health check failures
- API response time > 1s
- Disk usage > 80%

### Log Aggregation

Forward logs to your centralized logging system:

```bash
# Example: Using Filebeat to stream logs
# Configure Filebeat to watch /app/logs/ volume
```

## Maintenance Tasks

### Daily Tasks
- Monitor health check status
- Review error logs
- Check disk usage

### Weekly Tasks
- Review performance metrics
- Test backup restoration
- Audit access logs

### Monthly Tasks
- Update dependencies
- Rotate API keys
- Review security logs
- Verify disaster recovery readiness

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs api

# Verify secrets exist
ls -la secrets/

# Check environment variables
docker-compose -f docker-compose.prod.yml config
```

### Health Check Failing

```bash
# Manual health check
docker-compose -f docker-compose.prod.yml exec api wget -qO- http://localhost:3000/health

# Check database
docker-compose -f docker-compose.prod.yml exec api sqlite3 /app/data/donations.db "SELECT COUNT(*) FROM sqlite_master WHERE type='table';"
```

### Memory Pressure

```bash
# Check memory usage
docker-compose -f docker-compose.prod.yml stats api

# If needed, increase memory limit in docker-compose.prod.yml
```

### Disk Space Issues

```bash
# Check volume sizes
docker volume ls

# Inspect logs volume
du -sh /var/lib/docker/volumes/*/\_data

# Clean old logs
docker-compose -f docker-compose.prod.yml exec api find /app/logs -mtime +30 -delete
```

## Advanced Configuration

### Using Docker Swarm Secrets

For production Swarm deployments:

```bash
# Create secrets in Swarm
docker secret create encryption_key - < secrets/encryption_key.txt
docker secret create api_keys - < secrets/api_keys.txt

# Deploy stack
docker stack deploy -c docker-compose.prod.yml stellar
```

### Using Kubernetes Secrets

For Kubernetes deployments:

```bash
# Create secrets
kubectl create secret generic stellar-secrets \
  --from-file=encryption_key=secrets/encryption_key.txt \
  --from-file=api_keys=secrets/api_keys.txt

# Mount in pod spec
volumeMounts:
  - name: secrets
    mountPath: /run/secrets
    readOnly: true
```

### Using Environment Variable Files

For simpler setups, use `.env.prod`:

```bash
# Create .env.prod (never commit this file!)
ENCRYPTION_KEY=$(cat secrets/encryption_key.txt)
API_KEYS=$(cat secrets/api_keys.txt)
# ... other variables

# Deploy with env file
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

## Performance Tuning

### Database Optimization

```javascript
// In production startup:
db.run("PRAGMA journal_mode = WAL");        // Write-Ahead Logging
db.run("PRAGMA synchronous = NORMAL");      // Reduce sync overhead
db.run("PRAGMA cache_size = 10000");        // Increase cache
db.run("PRAGMA temp_store = MEMORY");       // Use memory for temp tables
```

### Connection Pooling

Implement connection pooling for better resource utilization:

```javascript
const pool = createPool({
  max: 5,
  min: 2,
  acquire: 30000,
  idle: 10000
});
```

## Support and References

- **API Documentation**: See `docs/api-examples.md`
- **Architecture**: See `docs/architecture.md`
- **Configuration**: See `docs/configuration.md`
- **Security**: See `SECURITY.md`
- **Backup Guide**: See `docs/backup-restore.md`

## Deployment Checklist

Before going live:

- [ ] Secrets directory created with all required files
- [ ] Resource limits configured for your infrastructure
- [ ] Health check endpoint verified
- [ ] Logging configuration matches your log aggregation
- [ ] Backup/restore procedure tested
- [ ] SSL/TLS certificates provisioned
- [ ] Database migrations run successfully
- [ ] Smoke tests pass against production environment
- [ ] Monitoring and alerting configured
- [ ] Incident response plan documented
- [ ] Team trained on deployment procedures
- [ ] Disaster recovery procedures tested
