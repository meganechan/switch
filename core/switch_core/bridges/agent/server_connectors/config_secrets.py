"""Encrypting the secret fields of a connector's stored configuration.

`ServerConnector.connection_config` is a plain JSONB column, so anything a
connector needs in order to authenticate — a password, a bearer token — used to
sit in the database in the clear. The only protection was that the admin form
masked the input and the gateway never read it back, neither of which helps
anyone holding a database dump.

A config class declares which of its fields are secret; those values are
encrypted on the way in and decrypted on the way out, with the same Fernet key
the registration tokens already use. Fields that are not declared secret are
untouched, so the stored config stays readable and debuggable apart from the
parts that must not be.

**Rows written before this existed still work.** An encrypted value carries a
version prefix, so a value without one is recognised as legacy plaintext and
passed through rather than failing to decrypt. It is logged once, at warning,
because "your secret is still in the clear" is a fact an operator should be
able to find out — and it stops being true the next time the connector is
registered.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from switch_core.crypto import decrypt_token, encrypt_token

if TYPE_CHECKING:
    from switch_core.bridges.agent.server_connectors.base import (
        ServerSideConnectorConfig,
    )

logger = logging.getLogger(__name__)

ENCRYPTED_PREFIX = "enc:v1:"
"""Marks a value this module encrypted. Versioned so the scheme can change
without having to guess what an unmarked value is."""


class ConnectorSecretError(Exception):
    """A declared secret could not be decrypted."""


def encrypt_secret_fields(
    connection_config: dict[str, Any],
    config_cls: type[ServerSideConnectorConfig],
    encryption_secret: str,
) -> dict[str, Any]:
    """Return a copy with every declared secret field encrypted."""
    result = dict(connection_config)
    for field in config_cls.secret_fields:
        value = result.get(field)
        if not isinstance(value, str) or not value:
            continue
        if value.startswith(ENCRYPTED_PREFIX):
            continue
        result[field] = ENCRYPTED_PREFIX + encrypt_token(value, encryption_secret)
    return result


def decrypt_secret_fields(
    connection_config: dict[str, Any],
    config_cls: type[ServerSideConnectorConfig],
    encryption_secret: str,
    *,
    connector_id: str,
) -> dict[str, Any]:
    """Return a copy with every declared secret field decrypted.

    A value with no version prefix predates encryption and is returned as-is.
    A value that claims to be encrypted and is not decryptable raises: the
    connector cannot authenticate without it, and starting anyway would fail
    later and less clearly.
    """
    result = dict(connection_config)
    for field in config_cls.secret_fields:
        value = result.get(field)
        if not isinstance(value, str) or not value:
            continue

        if not value.startswith(ENCRYPTED_PREFIX):
            logger.warning(
                "Connector %s has %r stored unencrypted; it predates config "
                "encryption and will be encrypted when the connector is next "
                "registered",
                connector_id,
                field,
            )
            continue

        try:
            result[field] = decrypt_token(
                value[len(ENCRYPTED_PREFIX) :], encryption_secret
            )
        except Exception as exc:
            raise ConnectorSecretError(
                f"Could not decrypt {field!r} for connector {connector_id}. "
                "The encryption secret has probably changed since it was "
                "registered; re-register the connector to store it again."
            ) from exc
    return result
