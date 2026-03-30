"""
Tests for sdk/python/webhook_verifier.py

Run with:  python -m pytest sdk/python/test_webhook_verifier.py -v --tb=short
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from webhook_verifier import verify_signature  # noqa: E402

# ── Load shared test vectors ────────────────────────────────────────────────
_VECTORS_PATH = os.path.join(os.path.dirname(__file__), '..', 'test-vectors', 'vectors.json')
with open(_VECTORS_PATH) as f:
    _VECTORS = json.load(f)['vectors']


# ── Test-vector parity ──────────────────────────────────────────────────────
@pytest.mark.parametrize('v', _VECTORS, ids=[v['description'] for v in _VECTORS])
def test_valid_vectors(v):
    assert verify_signature(v['payload'], v['expected_signature'], v['secret']) is True


# ── Valid signature (string payload) ───────────────────────────────────────
def test_valid_string_payload():
    v = _VECTORS[0]
    assert verify_signature(v['payload'], v['expected_signature'], v['secret']) is True


# ── Valid signature (bytes payload) ────────────────────────────────────────
def test_valid_bytes_payload():
    v = _VECTORS[0]
    assert verify_signature(v['payload'].encode(), v['expected_signature'], v['secret']) is True


# ── Tampered payload ────────────────────────────────────────────────────────
def test_tampered_payload():
    v = _VECTORS[0]
    assert verify_signature(v['payload'] + ' tampered', v['expected_signature'], v['secret']) is False


# ── Wrong secret ────────────────────────────────────────────────────────────
def test_wrong_secret():
    v = _VECTORS[0]
    assert verify_signature(v['payload'], v['expected_signature'], 'wrong-secret') is False


# ── Wrong signature ─────────────────────────────────────────────────────────
def test_wrong_signature():
    assert verify_signature('hello world', 'deadbeef' * 8, 'my-secret-key') is False


# ── Type guards ─────────────────────────────────────────────────────────────
def test_non_string_signature_returns_false():
    assert verify_signature('payload', None, 'secret') is False


def test_non_string_secret_returns_false():
    assert verify_signature('payload', 'abc', None) is False


# ── All vectors fail with wrong secret ─────────────────────────────────────
@pytest.mark.parametrize('v', _VECTORS, ids=[v['description'] for v in _VECTORS])
def test_all_vectors_fail_wrong_secret(v):
    assert verify_signature(v['payload'], v['expected_signature'], 'wrong') is False
