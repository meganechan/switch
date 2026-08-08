"""Tests for switch-core reporting its own version (CHOO-1865)."""

from __future__ import annotations

import logging
import re
import tomllib
from importlib.metadata import PackageNotFoundError
from pathlib import Path

import pytest

from switch_core import version as version_module
from switch_core.version import switch_core_version

PYPROJECT = Path(__file__).resolve().parents[2] / "pyproject.toml"


@pytest.fixture(autouse=True)
def _clear_cache() -> None:
    switch_core_version.cache_clear()


def _raise_not_found(name: str) -> str:
    raise PackageNotFoundError(name)


def test_matches_the_version_declared_in_pyproject() -> None:
    """The running version is the one pyproject declares, with no second copy.

    A `__version__` constant beside pyproject would be one more thing to keep
    in step by hand — the drift CHOO-1865 exists to end.
    """
    declared = tomllib.loads(PYPROJECT.read_text())["project"]["version"]
    assert switch_core_version() == declared


def test_the_declared_version_is_three_part_semver() -> None:
    """Every Switch artifact carries MAJOR.MINOR.PATCH, switch-core included."""
    declared = tomllib.loads(PYPROJECT.read_text())["project"]["version"]
    assert re.fullmatch(r"\d+\.\d+\.\d+", declared), declared


def test_unknown_when_distribution_metadata_is_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unreadable version is None, never a placeholder.

    "0.0.0" or "unknown" would read downstream as a version somebody chose.
    Unknown has to stay distinguishable from known.
    """
    monkeypatch.setattr(version_module, "distribution_version", _raise_not_found)
    assert switch_core_version() is None


def test_warns_when_the_version_cannot_be_read(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Degraded, but disclosed — a silent None would hide a broken install."""
    monkeypatch.setattr(version_module, "distribution_version", _raise_not_found)
    with caplog.at_level(logging.WARNING, logger=version_module.__name__):
        switch_core_version()
    assert any(record.levelno == logging.WARNING for record in caplog.records)
