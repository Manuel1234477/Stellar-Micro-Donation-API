/**
 * ReportGenerator - Generates performance reports from load test results
 *
 * Produces JSON summaries and HTML reports with trend visualizations.
 * Reports include p50/p95/p99 latency, throughput, and error rates per scenario.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { validateReport } = require('./PerformanceBaselines');

/**
 * Generate a JSON performance report
 * @param {LoadTestReport} report - Result from LoadTestRunner.runAll
 * @param {string} [outputPath] - Optional file path to write JSON to
 * @returns {{ report: LoadTestReport, validation: object, summary: string }}
 */
function generateJsonReport(report, outputPath) {
  const validation = validateReport(report);

  const output = {
    generatedAt: new Date().toISOString(),
    passed: validation.allPassed,
    scenarios: report.scenarios.map(s => ({
      scenario: s.scenario,
      totalRequests: s.totalRequests,
      errorRate: parseFloat((s.errorRate * 100).toFixed(2)),
      throughputRps: parseFloat(s.throughput.toFixed(2)),
      latencyMs: {
        p50: s.latency.p50,
        p95: s.latency.p95,
        p99: s.latency.p99,
        mean: parseFloat(s.latency.mean.toFixed(2)),
      },
      baselineViolations: validation.results.find(v => v.scenario === s.scenario)?.violations || [],
    })),
  };

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  }

  return output;
}

/**
 * Generate an HTML performance report
 * @param {LoadTestReport} report - Result from LoadTestRunner.runAll
 * @param {string} [outputPath] - Optional file path to write HTML to
 * @returns {string} HTML string
 */
function generateHtmlReport(report, outputPath) {
  const jsonReport = generateJsonReport(report);
  const statusColor = jsonReport.passed ? '#28a745' : '#dc3545';
  const statusText = jsonReport.passed ? 'PASSED' : 'FAILED';

  const scenarioRows = jsonReport.scenarios.map(s => `
    <tr>
      <td><strong>${s.scenario}</strong></td>
      <td>${s.totalRequests}</td>
      <td>${s.latencyMs.p50} ms</td>
      <td>${s.latencyMs.p95} ms</td>
      <td>${s.latencyMs.p99} ms</td>
      <td>${s.throughputRps} req/s</td>
      <td>${s.errorRate}%</td>
      <td style="color: ${s.baselineViolations.length === 0 ? '#28a745' : '#dc3545'}">
        ${s.baselineViolations.length === 0 ? 'PASS' : 'FAIL: ' + s.baselineViolations.join('; ')}
      </td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Load Test Report - Stellar Micro-Donation API</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 2rem; color: #333; }
    h1 { color: #1a1a2e; }
    .status { display: inline-block; padding: 0.4rem 1rem; border-radius: 4px; color: white; font-weight: bold; background: ${statusColor}; }
    table { border-collapse: collapse; width: 100%; margin-top: 1.5rem; }
    th, td { border: 1px solid #ddd; padding: 0.6rem 1rem; text-align: left; }
    th { background: #f4f4f4; font-weight: 600; }
    tr:nth-child(even) { background: #fafafa; }
    .meta { color: #666; font-size: 0.9rem; margin: 0.5rem 0; }
  </style>
</head>
<body>
  <h1>Load Test Report</h1>
  <p class="meta">Generated: ${jsonReport.generatedAt}</p>
  <p>Overall status: <span class="status">${statusText}</span></p>
  <table>
    <thead>
      <tr>
        <th>Scenario</th><th>Requests</th><th>p50</th><th>p95</th><th>p99</th>
        <th>Throughput</th><th>Error Rate</th><th>Baseline</th>
      </tr>
    </thead>
    <tbody>${scenarioRows}</tbody>
  </table>
</body>
</html>`;

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, html, 'utf8');
  }

  return html;
}

module.exports = { generateJsonReport, generateHtmlReport };
