from __future__ import annotations

import pytest

from switch_core.aliases import (
    AliasError,
    check_alias_collisions,
    validate_alias_format,
    validate_alias_map,
)


class TestValidateFormat:
    @pytest.mark.parametrize("alias", ["bob", "bug-bot", "v2.fixer", "a_b", "Bob"])
    def test_valid(self, alias: str) -> None:
        validate_alias_format(alias)  # does not raise

    @pytest.mark.parametrize(
        "alias", ["", "has space", "with@at", "emoji✨", "a/b", "comma,"]
    )
    def test_invalid(self, alias: str) -> None:
        with pytest.raises(AliasError):
            validate_alias_format(alias)


class TestCollisions:
    def test_clash_with_agent_name(self) -> None:
        with pytest.raises(AliasError, match="real name"):
            check_alias_collisions(
                "alice",
                target_agent_id="a2",
                agent_names=["alice", "bob"],
                role_names=[],
                aliases_by_agent={},
            )

    def test_clash_with_agent_name_case_insensitive(self) -> None:
        with pytest.raises(AliasError, match="real name"):
            check_alias_collisions(
                "ALICE",
                target_agent_id="a2",
                agent_names=["alice"],
                role_names=[],
                aliases_by_agent={},
            )

    def test_clash_with_role(self) -> None:
        with pytest.raises(AliasError, match="role"):
            check_alias_collisions(
                "manager",
                target_agent_id="a2",
                agent_names=["alice"],
                role_names=["manager"],
                aliases_by_agent={},
            )

    def test_clash_with_other_alias(self) -> None:
        with pytest.raises(AliasError, match="already used"):
            check_alias_collisions(
                "fixer",
                target_agent_id="a2",
                agent_names=["alice", "bob"],
                role_names=[],
                aliases_by_agent={"a1": "fixer"},
            )

    def test_replacing_own_alias_is_allowed(self) -> None:
        # Same agent re-aliasing to a value only it currently holds is fine.
        check_alias_collisions(
            "fixer",
            target_agent_id="a1",
            agent_names=["alice"],
            role_names=[],
            aliases_by_agent={"a1": "fixer"},
        )

    def test_no_collision(self) -> None:
        check_alias_collisions(
            "fixer",
            target_agent_id="a2",
            agent_names=["alice", "bob"],
            role_names=["manager"],
            aliases_by_agent={"a1": "helper"},
        )


class TestValidateMap:
    def test_ok(self) -> None:
        validate_alias_map(
            {"alice": "boss", "bob": "fixer"},
            agent_names=["alice", "bob"],
            role_names=["reviewer"],
        )

    def test_target_not_in_room(self) -> None:
        with pytest.raises(AliasError, match="not an agent in this room"):
            validate_alias_map(
                {"carol": "boss"},
                agent_names=["alice", "bob"],
                role_names=[],
            )

    def test_two_agents_same_alias_in_map(self) -> None:
        with pytest.raises(AliasError, match="already used"):
            validate_alias_map(
                {"alice": "dup", "bob": "dup"},
                agent_names=["alice", "bob"],
                role_names=[],
            )

    def test_alias_equals_other_agent_name(self) -> None:
        with pytest.raises(AliasError, match="real name"):
            validate_alias_map(
                {"alice": "bob"},
                agent_names=["alice", "bob"],
                role_names=[],
            )
