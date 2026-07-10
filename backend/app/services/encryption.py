"""
Data Encryption Service (SOC-16)
════════════════════════════════

Two-way encryption for sensitive student data using Fernet (symmetric encryption).
All personally identifiable information and learning data encrypted at rest.

Encryption Strategy:
  - User profiles: encrypted full_name, email, university
  - Learning data: encrypted pset content, attempt responses, AI interactions
  - API keys: encrypted in database, decrypted only when needed
  - Key rotation: support for multiple keys with key_id versioning

Security Model:
  - Encryption key NEVER committed to code
  - Read from environment variable or secure key management service
  - Each record has key_id field for rotation support
  - Data encrypted before DB write, decrypted on read
"""

from __future__ import annotations

import base64
import json
import os
from typing import Any

from cryptography.fernet import Fernet, MultiFernet


class EncryptionService:
    """
    Symmetric encryption service using Fernet (AES-128-CBC + HMAC).

    Usage:
        svc = EncryptionService()
        encrypted = svc.encrypt_text("sensitive data")
        original = svc.decrypt_text(encrypted)
    """

    def __init__(self):
        """Initialize with encryption keys from environment."""
        # Primary key (current) - used for new encryptions
        primary_key = os.getenv("ENCRYPTION_KEY_PRIMARY")
        if not primary_key:
            raise RuntimeError(
                "ENCRYPTION_KEY_PRIMARY not set. Generate with: "
                "python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
            )

        # Secondary keys (for rotation) - used only for decryption
        secondary_keys_str = os.getenv("ENCRYPTION_KEYS_SECONDARY", "")
        secondary_keys = [k.strip() for k in secondary_keys_str.split(",") if k.strip()]

        # Build MultiFernet for key rotation
        all_keys = [primary_key.encode()] + [k.encode() for k in secondary_keys]
        self._fernets = [Fernet(key) for key in all_keys]
        self._cipher = MultiFernet(self._fernets)
        self._primary_fernet = self._fernets[0]

    def encrypt_text(self, plaintext: str) -> str:
        """
        Encrypt a text string.

        Returns: base64-encoded encrypted token (safe for DB storage)
        """
        if not plaintext:
            return ""
        token = self._primary_fernet.encrypt(plaintext.encode())
        return token.decode()  # Fernet token is already base64

    def decrypt_text(self, ciphertext: str) -> str:
        """
        Decrypt a text string.

        Automatically tries all configured keys (supports key rotation).
        Raises cryptography.fernet.InvalidToken if decryption fails.
        """
        if not ciphertext:
            return ""
        plaintext_bytes = self._cipher.decrypt(ciphertext.encode())
        return plaintext_bytes.decode()

    def encrypt_json(self, data: dict | list) -> str:
        """Encrypt a JSON-serializable structure."""
        json_str = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        return self.encrypt_text(json_str)

    def decrypt_json(self, ciphertext: str) -> dict | list:
        """Decrypt back to original JSON structure."""
        if not ciphertext:
            return {}
        json_str = self.decrypt_text(ciphertext)
        return json.loads(json_str)

    def encrypt_bytes(self, data: bytes) -> bytes:
        """Encrypt raw bytes (for file content)."""
        return self._primary_fernet.encrypt(data)

    def decrypt_bytes(self, ciphertext: bytes) -> bytes:
        """Decrypt raw bytes."""
        return self._cipher.decrypt(ciphertext)

    def rotate_encryption(self, old_ciphertext: str) -> str:
        """
        Re-encrypt data with the current primary key.

        Use this to rotate encrypted data to the latest key after key rotation.
        """
        if not old_ciphertext:
            return ""
        # Decrypt with any available key
        plaintext = self.decrypt_text(old_ciphertext)
        # Re-encrypt with current primary
        return self.encrypt_text(plaintext)


# ── Global instance ───────────────────────────────────────────────────────────

_encryption_service: EncryptionService | None = None


def get_encryption_service() -> EncryptionService:
    """Get or create the global encryption service instance."""
    global _encryption_service
    if _encryption_service is None:
        _encryption_service = EncryptionService()
    return _encryption_service


# ── Helper functions ──────────────────────────────────────────────────────────

def encrypt(plaintext: str) -> str:
    """Shorthand: encrypt text."""
    return get_encryption_service().encrypt_text(plaintext)


def decrypt(ciphertext: str) -> str:
    """Shorthand: decrypt text."""
    return get_encryption_service().decrypt_text(ciphertext)


def encrypt_dict(data: dict) -> str:
    """Shorthand: encrypt dict to JSON."""
    return get_encryption_service().encrypt_json(data)


def decrypt_dict(ciphertext: str) -> dict:
    """Shorthand: decrypt JSON to dict."""
    result = get_encryption_service().decrypt_json(ciphertext)
    return result if isinstance(result, dict) else {}
