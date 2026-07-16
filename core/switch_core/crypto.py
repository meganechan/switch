from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet


def _derive_fernet_key(secret: str) -> bytes:
    return base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())


def encrypt_token(plaintext: str, secret: str) -> str:
    f = Fernet(_derive_fernet_key(secret))
    return f.encrypt(plaintext.encode()).decode()


def decrypt_token(encrypted: str, secret: str) -> str:
    f = Fernet(_derive_fernet_key(secret))
    return f.decrypt(encrypted.encode()).decode()
