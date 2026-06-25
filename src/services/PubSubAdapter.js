'use strict';

const { EventEmitter } = require('events');
const log = require('../utils/log');

/**
 * PubSubAdapter — pluggable pub/sub backend for SseManager.
 *
 * In-process backend (default): EventEmitter — single instance only.
 * Redis backend: uses ioredis pub/sub — events cross instances.
 *
 * Select via PUBSUB_ADAPTER env var: 'memory' (default) | 'redis'
 */

class PubSubAdapter {
  async publish(channel, message) { throw new Error('Not implemented'); }
  subscribe(channel, handler) { throw new Error('Not implemented'); }
  async close() {}
}

class MemoryPubSubAdapter extends PubSubAdapter {
  constructor() {
    super();
    this._emitter = new EventEmitter();
    this._emitter.setMaxListeners(100);
  }

  async publish(channel, message) {
    this._emitter.emit(channel, message);
  }

  subscribe(channel, handler) {
    this._emitter.on(channel, handler);
  }

  unsubscribe(channel, handler) {
    this._emitter.off(channel, handler);
  }
}

class RedisPubSubAdapter extends PubSubAdapter {
  constructor(publishClient, subscribeClient) {
    super();
    this._pub = publishClient;
    this._sub = subscribeClient;
    this._handlers = new Map(); // channel -> Set<handler>
  }

  async publish(channel, message) {
    await this._pub.publish(channel, JSON.stringify(message));
  }

  subscribe(channel, handler) {
    if (!this._handlers.has(channel)) {
      this._handlers.set(channel, new Set());
      this._sub.subscribe(channel);
      this._sub.on('message', (ch, msg) => {
        if (ch !== channel) return;
        let parsed;
        try { parsed = JSON.parse(msg); } catch (_) { return; }
        for (const h of (this._handlers.get(ch) || [])) {
          try { h(parsed); } catch (e) { log.error('PUBSUB', 'Handler error', { error: e.message }); }
        }
      });
    }
    this._handlers.get(channel).add(handler);
  }

  async close() {
    try { await this._sub.quit(); } catch (_) {}
    try { await this._pub.quit(); } catch (_) {}
  }
}

let _instance = null;

function getPubSubAdapter() {
  if (_instance) return _instance;
  const type = (process.env.PUBSUB_ADAPTER || 'memory').toLowerCase();
  if (type === 'redis') {
    try {
      const Redis = require('ioredis');
      const url = process.env.REDIS_URL;
      if (url) {
        _instance = new RedisPubSubAdapter(new Redis(url), new Redis(url));
        return _instance;
      }
    } catch (_) {}
    log.warn('PUBSUB', 'Redis adapter requested but unavailable; using memory');
  }
  _instance = new MemoryPubSubAdapter();
  return _instance;
}

function _setAdapter(adapter) { _instance = adapter; }

module.exports = { PubSubAdapter, MemoryPubSubAdapter, RedisPubSubAdapter, getPubSubAdapter, _setAdapter };
