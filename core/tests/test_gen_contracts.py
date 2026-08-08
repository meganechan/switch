"""Tests for the contract registry and the generator that compiles it in.

The registry is the root of every compatibility answer the system will give,
so a malformed entry must fail at build time rather than reach a running
artifact — where a wrong number reads as "compatible".
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest
import yaml

from switch_core.contracts import CONTRACTS, contract_range

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_generator() -> ModuleType:
    """Import scripts/gen_contracts.py, which is not an installed package."""
    path = REPO_ROOT / "scripts" / "gen_contracts.py"
    spec = importlib.util.spec_from_file_location("gen_contracts", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # Register before executing: dataclasses resolve annotations through
    # sys.modules, and a module absent from it fails to build its fields.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


gen_contracts = _load_generator()


def _write_registry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, body: object
) -> None:
    source = tmp_path / "contracts.yaml"
    source.write_text(yaml.safe_dump({"contracts": body}))
    monkeypatch.setattr(gen_contracts, "SOURCE", source)


def test_generated_modules_are_current() -> None:
    """The committed modules match what the generator would write.

    CI runs the same check; having it here too means `just test` catches a
    forgotten regeneration before the push rather than after.
    """
    assert gen_contracts.main.__module__  # generator imported cleanly
    contracts = gen_contracts.load_contracts()
    for target in gen_contracts.TARGETS:
        assert target.path.read_text() == target.render(contracts), (
            f"{target.path.relative_to(REPO_ROOT)} is stale — run `just contracts`"
        )


def test_every_contract_declares_at_least_one_artifact() -> None:
    for name, artifacts in CONTRACTS.items():
        assert artifacts, f"contract {name} declares no artifacts"


def test_accepts_never_exceeds_speaks() -> None:
    for name, artifacts in CONTRACTS.items():
        for artifact, declared in artifacts.items():
            assert declared.accepts <= declared.speaks, (
                f"{name}/{artifact} declares an empty range"
            )


def test_contract_range_returns_the_declared_pair() -> None:
    declared = contract_range("agent-protocol", "switch-core")
    assert declared.speaks >= 1
    assert declared.accepts >= 1


@pytest.mark.parametrize(
    ("contract", "artifact"),
    [
        ("agent-protocol", "not-an-artifact"),
        ("not-a-contract", "switch-core"),
        # switch-core plays no part in sidecar-control, so asking is a bug.
        ("sidecar-control", "switch-core"),
    ],
)
def test_contract_range_refuses_unregistered_pairs(
    contract: str, artifact: str
) -> None:
    """An unregistered pair raises rather than returning a default.

    Any default here would be a number nobody chose, silently reported as if
    someone had.
    """
    with pytest.raises(KeyError, match="declares no range"):
        contract_range(contract, artifact)


def test_db_schema_is_declared_only_by_switch_core() -> None:
    """db-schema is internal, and must never gain an external peer.

    It is excluded from every externally facing response; a second artifact
    appearing here would mean that exclusion had stopped being true.
    """
    assert set(CONTRACTS["db-schema"]) == {"switch-core"}


def test_registry_rejects_an_empty_range(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_registry(
        tmp_path,
        monkeypatch,
        {"demo": {"description": "d", "artifacts": {"a": {"speaks": 1, "accepts": 2}}}},
    )
    with pytest.raises(ValueError, match="is above speaks"):
        gen_contracts.load_contracts()


def test_registry_rejects_a_non_integer_revision(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_registry(
        tmp_path,
        monkeypatch,
        {
            "demo": {
                "description": "d",
                "artifacts": {"a": {"speaks": "1", "accepts": 1}},
            }
        },
    )
    with pytest.raises(ValueError, match="must be an integer"):
        gen_contracts.load_contracts()


def test_registry_rejects_a_zero_revision(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Revisions start at 1 so that a missing or zero-valued field is distinct."""
    _write_registry(
        tmp_path,
        monkeypatch,
        {"demo": {"description": "d", "artifacts": {"a": {"speaks": 0, "accepts": 0}}}},
    )
    with pytest.raises(ValueError, match="must be an integer"):
        gen_contracts.load_contracts()


def test_registry_rejects_a_missing_description(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_registry(
        tmp_path,
        monkeypatch,
        {"demo": {"artifacts": {"a": {"speaks": 1, "accepts": 1}}}},
    )
    with pytest.raises(ValueError, match="description is required"):
        gen_contracts.load_contracts()


def test_registry_rejects_extra_declaration_keys(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Only speaks and accepts. A stray key is a misunderstanding, not an extra."""
    _write_registry(
        tmp_path,
        monkeypatch,
        {
            "demo": {
                "description": "d",
                "artifacts": {"a": {"speaks": 1, "accepts": 1, "version": "1.2.3"}},
            }
        },
    )
    with pytest.raises(ValueError, match="expected exactly"):
        gen_contracts.load_contracts()
