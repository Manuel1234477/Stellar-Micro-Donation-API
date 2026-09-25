# ── Build stage ──────────────────────────────────────────────────────────────
# Pin base image by digest for reproducible builds and supply chain security
# Use node:20-alpine for minimal attack surface (no package manager, no shell in prod)
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only (no dev dependencies in builder output)
# Using npm ci ensures reproducible installs from package-lock.json
RUN npm ci --omit=dev

# Copy application source
COPY . .

# ── Production stage ──────────────────────────────────────────────────────────
# Pinned digest ensures reproducible production image across builds
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293

WORKDIR /app

# Create dedicated non-root user (UID 1001) for least privilege
RUN addgroup -g 1001 -S appgroup && adduser -u 1001 -S appuser -G appgroup

# Copy only production artifacts from builder (excludes dev deps and build tooling)
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/src ./src
COPY --from=builder --chown=appuser:appgroup /app/package.json ./package.json

# Create data and temporary directories with proper non-root permissions
RUN mkdir -p /app/data /data /tmp && chown -R appuser:appgroup /app /data /tmp

# Declare writable volumes for read-only root filesystem support
VOLUME ["/data", "/tmp"]

# Switch to non-root user before running application
USER appuser

# Document the service port
EXPOSE 3000

# Health check to verify application is running and responsive
# Probes the readiness endpoint which indicates application is ready to serve requests
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health/ready || exit 1

# Start application
CMD ["node", "src/app.js"]
