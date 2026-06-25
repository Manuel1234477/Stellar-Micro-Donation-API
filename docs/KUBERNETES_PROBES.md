# Kubernetes Liveness and Readiness Probes

The API exposes two dedicated health endpoints designed for container orchestration probes.

## Endpoints

| Endpoint | Purpose | Rate limited |
|---|---|---|
| `GET /health/live` | Liveness — confirms the process is running | No |
| `GET /health/ready` | Readiness — confirms all dependencies are healthy | No |
| `GET /health` | Full health detail (admin: verbose mode) | Yes |

### `GET /health/live`

Returns `200 OK` as long as the Node.js process is alive. Never checks external
dependencies. Kubernetes uses this to decide whether to **restart** a pod.

```json
{ "status": "alive", "timestamp": "2024-01-15T10:30:00.000Z" }
```

### `GET /health/ready`

Returns `200 OK` only when all critical dependencies (SQLite database, Stellar network)
are reachable. Returns `503 Service Unavailable` during startup, graceful shutdown, or
when a dependency is down. Kubernetes uses this to decide whether to **route traffic**
to a pod.

**Healthy response (200):**
```json
{ "status": "ready", "timestamp": "2024-01-15T10:30:00.000Z" }
```

**Not-ready response (503):**
```json
{
  "status": "not_ready",
  "reason": "one or more critical dependencies are unavailable",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

During graceful shutdown the reason is `"server is shutting down"`, so Kubernetes stops
routing new requests before the process exits.

## Kubernetes Probe Configuration

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3000
  initialDelaySeconds: 15
  periodSeconds: 20
  timeoutSeconds: 5
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

### Guidance

- **liveness** only restarts the pod. Use a generous `initialDelaySeconds` (≥ 15 s) so
  the process has time to initialise before Kubernetes begins probing.
- **readiness** gates traffic. The endpoint returns 503 during shutdown so in-flight
  requests can drain before the pod is terminated (combine with a `preStop` sleep or
  `terminationGracePeriodSeconds` for zero-downtime rolling deployments).
- Both endpoints are **excluded from rate limiting** because Kubernetes calls them every
  few seconds per pod; including them in rate-limit counts would skew abuse metrics.

## Full Deployment Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: stellar-donation-api
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: api
          image: your-registry/stellar-micro-donation-api:latest
          ports:
            - containerPort: 3000
          env:
            - name: NODE_ENV
              value: production
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 20
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          lifecycle:
            preStop:
              exec:
                # Give in-flight requests a few seconds to drain before SIGTERM
                command: ["/bin/sh", "-c", "sleep 5"]
      terminationGracePeriodSeconds: 30
```

## Docker / Compose Health Check

The `Dockerfile` and `docker-compose.yml` both define a Docker healthcheck against the
`/health` endpoint (which includes full dependency information). This is separate from
the Kubernetes probes above and is used by the Docker daemon / Compose to mark the
container as `healthy` before dependent services start.

```yaml
# docker-compose.yml (already configured)
healthcheck:
  test: ['CMD', 'wget', '-qO-', 'http://localhost:3000/health']
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 10s
```

For Kubernetes deployments use the dedicated `/health/live` and `/health/ready` probes
instead of `/health`, as they are not rate-limited and return the minimal payload that
the kubelet needs.
