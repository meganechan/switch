"""Encrypting declared secret fields in a connector's stored configuration."""

from __future__ import annotations

from typing import ClassVar

import pytest

from switch_core.bridges.agent.server_connectors.base import ServerSideConnectorConfig
from switch_core.bridges.agent.server_connectors.config_secrets import (
    ENCRYPTED_PREFIX,
    ConnectorSecretError,
    decrypt_secret_fields,
    encrypt_secret_fields,
)

SECRET = "unit-test-encryption-secret"


class _Config(ServerSideConnectorConfig):
    secret_fields: ClassVar[frozenset[str]] = frozenset({"token", "password"})

    url: str = ""
    token: str = ""
    password: str = ""


class _NoSecrets(ServerSideConnectorConfig):
    url: str = ""


def _roundtrip(stored: dict[str, object]) -> dict[str, object]:
    return decrypt_secret_fields(stored, _Config, SECRET, connector_id="c1")


# ── The round trip ────────────────────────────────────────────────────────────


def test_a_secret_survives_encryption_and_decryption() -> None:
    stored = encrypt_secret_fields({"token": "s3cret"}, _Config, SECRET)
    assert _roundtrip(stored)["token"] == "s3cret"


def test_the_stored_value_does_not_contain_the_secret() -> None:
    # The whole point: a database dump must not hand over the token.
    stored = encrypt_secret_fields({"token": "s3cret"}, _Config, SECRET)
    assert "s3cret" not in str(stored)
    assert stored["token"].startswith(ENCRYPTED_PREFIX)  # type: ignore[union-attr]


def test_every_declared_secret_is_encrypted() -> None:
    # Distinctive values: a one-character secret would appear inside base64
    # ciphertext by chance and the assertion would prove nothing.
    stored = encrypt_secret_fields(
        {"token": "token-plaintext", "password": "password-plaintext"},
        _Config,
        SECRET,
    )
    assert "token-plaintext" not in str(stored)
    assert "password-plaintext" not in str(stored)


def test_fields_that_are_not_secret_stay_readable() -> None:
    # A config should still be debuggable in the database apart from the parts
    # that must not be.
    stored = encrypt_secret_fields(
        {"url": "https://agent.example", "token": "s3cret"}, _Config, SECRET
    )
    assert stored["url"] == "https://agent.example"


def test_a_config_declaring_no_secrets_is_untouched() -> None:
    original = {"url": "https://agent.example"}
    assert encrypt_secret_fields(original, _NoSecrets, SECRET) == original


def test_the_input_dictionary_is_not_mutated() -> None:
    original = {"token": "s3cret"}
    encrypt_secret_fields(original, _Config, SECRET)
    assert original == {"token": "s3cret"}


# ── Values that should be left alone ──────────────────────────────────────────


def test_an_empty_secret_is_not_encrypted() -> None:
    # AG-UI defines no authentication, so a blank token is a legitimate config
    # rather than a missing value to obscure.
    assert encrypt_secret_fields({"token": ""}, _Config, SECRET)["token"] == ""


def test_an_absent_secret_stays_absent() -> None:
    assert "token" not in encrypt_secret_fields({"url": "x"}, _Config, SECRET)


def test_encrypting_twice_does_not_double_wrap() -> None:
    once = encrypt_secret_fields({"token": "s3cret"}, _Config, SECRET)
    twice = encrypt_secret_fields(once, _Config, SECRET)
    assert once == twice
    assert _roundtrip(twice)["token"] == "s3cret"


# ── Rows written before encryption existed ────────────────────────────────────


def test_legacy_plaintext_is_passed_through_rather_than_failing() -> None:
    # Existing connectors have plaintext in the database. Refusing to start
    # them would turn a security improvement into an outage.
    legacy = {"token": "plaintext-from-before"}
    assert _roundtrip(legacy)["token"] == "plaintext-from-before"


def test_legacy_plaintext_is_reported(caplog: pytest.LogCaptureFixture) -> None:
    # Silently tolerating it would leave nobody aware the secret is exposed.
    with caplog.at_level("WARNING"):
        _roundtrip({"token": "plaintext-from-before"})
    assert "unencrypted" in caplog.text
    assert "c1" in caplog.text


def test_a_legacy_row_becomes_encrypted_when_written_again() -> None:
    legacy = {"token": "plaintext-from-before"}
    reregistered = encrypt_secret_fields(legacy, _Config, SECRET)
    assert reregistered["token"].startswith(ENCRYPTED_PREFIX)  # type: ignore[union-attr]


# ── Failure ───────────────────────────────────────────────────────────────────


def test_a_secret_encrypted_under_a_different_key_fails_loudly() -> None:
    # Silently starting with an unusable token would surface later as a
    # confusing 401 from the agent's endpoint.
    stored = encrypt_secret_fields({"token": "s3cret"}, _Config, "the-old-secret")
    with pytest.raises(
        ConnectorSecretError, match="encryption secret has probably changed"
    ):
        _roundtrip(stored)


def test_a_corrupt_encrypted_value_fails_loudly() -> None:
    with pytest.raises(ConnectorSecretError):
        _roundtrip({"token": ENCRYPTED_PREFIX + "not-a-fernet-token"})


def test_the_error_names_the_connector() -> None:
    stored = encrypt_secret_fields({"token": "s3cret"}, _Config, "other")
    with pytest.raises(ConnectorSecretError, match="c1"):
        _roundtrip(stored)
