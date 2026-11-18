'use strict';

/**
 * Separate, unauthenticated Prometheus listener (#1982).
 *
 * When METRICS_PORT is non-zero, `GET /metrics` is also served on this port
 * without application auth, the usual Kubernetes pattern: the port is reachable
 * only from the pod / cluster network, so scrapers need no API key. Leave
 * METRICS_PORT unset to keep metrics only on the main port behind `metrics:read`.
 *
 * Plain node:http is used on purpose: this listener must not pass through the
 * application middleware stack (auth, rate limits, request signing).
 */

const http = require('http');
const { registry } = require('../utils/metrics');
const log = require('../utils/log');

/**
 * Start the metrics listener.
 * @param {{ port: number, host?: string }} options
 * @returns {Promise<import('http').Server>} resolves once listening
 */
function startMetricsServer({ port, host = '0.0.0.0' }) {
  const server = http.createServer(async (req, res) => {
    const path = (req.url || '').split('?')[0];
    if (req.method !== 'GET' || path !== '/metrics') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not Found');
    }
    try {
      const body = await registry.metrics();
      res.writeHead(200, { 'Content-Type': registry.contentType });
      return res.end(body);
    } catch (err) {
      log.error('METRICS', 'Failed to generate metrics', { error: err.message });
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      return res.end('Failed to generate metrics');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      log.info('METRICS', `Metrics listener bound on ${host}:${port} (no application auth)`);
      resolve(server);
    });
  });
}

module.exports = { startMetricsServer };
