# ── Build stage ──────────────────────────────────────────────────────────────
# Pin base image by digest for reproducible builds and supply chain security
# Use node:24-alpine for minimal attack surface (no package manager, no shell in prod)
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only (no dev dependencies in builder output)
# Using npm ci ensures reproducible installs from package-lock.json
RUN npm ci --omit=dev

# Copy application source
COPY src ./src

# ── Production stage ──────────────────────────────────────────────────────────
# Pinned digest ensures reproducible production image across builds
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f

WORKDIR /app

# Create dedicated non-root user (UID 1001) for least privilege
RUN addgroup -g 1001 -S appgroup && adduser -u 1001 -S appuser -G appgroup

# Copy only production artifacts from builder (excludes dev deps and build tooling)
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/src ./src
COPY --from=builder --chown=appuser:appgroup /app/package.json ./package.json

# Create data and temporary directories with proper non-root permissions
RUN mkdir -p /data /tmp && chown -R appuser:appgroup /app /data /tmp

# Declare writable volumes for read-only root filesystem support
VOLUME ["/data", "/tmp"]

# Switch to non-root user before running application
USER appuser

# Document the service port
EXPOSE 3000

# Health check to verify the application process is alive and responsive.
# Probes the liveness endpoint, which is process-only and does not check
# external dependencies: a dependency outage must not cause Docker to
# restart otherwise healthy containers. Readiness is handled by orchestrators.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health/live || exit 1

# Start application
CMD ["node", "src/app.js"]
