"""
Webhook signature verification SDK for Python.

Verifies the X-Webhook-Signature header against a raw request payload
using HMAC-SHA256 and a shared secret.
"""

import hashlib
import hmac


def verify_signature(payload: str | bytes, signature: str, secret: str) -> bool:
    """
    Verify an X-Webhook-Signature header against a raw request payload.

    Args:
        payload:   The raw request body (str or bytes) before any parsing.
        signature: The hex-encoded HMAC-SHA256 signature from the header.
        secret:    The shared secret used to sign the webhook.

    Returns:
        True if the signature is valid, False otherwise.

    Example::

        import os
        from webhook_verifier import verify_signature

        is_valid = verify_signature(request.get_data(), request.headers.get('X-Webhook-Signature'), os.environ['WEBHOOK_SECRET'])
    """
    if not isinstance(signature, str) or not isinstance(secret, str):
        return False

    if isinstance(payload, str):
        payload = payload.encode()

    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
