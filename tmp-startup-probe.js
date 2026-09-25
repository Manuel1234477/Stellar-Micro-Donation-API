'use strict';
const { spawn } = require('child_process');
const http = require('http');

const env = Object.assign({}, process.env, {
  PORT: '3097',
  NODE_ENV: 'test',
  MOCK_STELLAR: 'true',
  USE_MOCK_STELLAR: 'true',
  API_KEYS: 'shutdown-test-key',
  ENCRYPTION_KEY: 'test_encryption_key_fixed_32bytes_hex_value_here_00',
  SHUTDOWN_TIMEOUT_MS: '5000',
});

const child = spawn(process.execPath, ['src/app.js'], { env: env, stdio: 'pipe' });
var out = [], err = [], reached = false;
child.stdout.on('data', function(d) { out.push(d.toString()); });
child.stderr.on('data', function(d) { err.push(d.toString()); });
child.on('exit', function(code, sig) {
  if (!reached) {
    console.log('=== STDOUT ===');
    console.log(out.join('').slice(0, 3000));
    console.log('=== STDERR ===');
    console.log(err.join('').slice(0, 3000));
  }
  console.log('EXIT code=' + code + ' signal=' + sig);
  process.exit(0);
});

var start = Date.now();
function poll() {
  if (reached) return;
  if (Date.now() - start > 12000) { console.log('POLL TIMEOUT'); child.kill('SIGKILL'); return; }
  var req = http.get('http://localhost:3097/health/live', function(res) {
    reached = true;
    console.log('/health/live responded: ' + res.statusCode);
    child.kill('SIGTERM');
  });
  req.on('error', function() { setTimeout(poll, 300); });
  req.setTimeout(500, function() { req.destroy(); setTimeout(poll, 300); });
}
setTimeout(poll, 500);
