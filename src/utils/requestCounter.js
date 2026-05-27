'use strict';

/**
 * In-flight request counter.
 * Used by the Express lifecycle middleware to track active requests,
 * and by the backup restore endpoint to block restores during active traffic.
 */

let count = 0;

function increment() {
  count++;
}

function decrement() {
  if (count > 0) count--;
}

function getCount() {
  return count;
}

module.exports = { increment, decrement, getCount };
