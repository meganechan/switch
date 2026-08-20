"""Per-agent Slack user groups — the handle that makes an agent name complete.

An agent is not a Slack user, so Slack's `@` menu cannot offer it. Minting a
user group per agent is what puts the name in that menu; these tests cover the
round trip (group id in, agent name out), the lifecycle, and the refusals that
must stay loud rather than leaving an agent silently unmentionable.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from slack_sdk.errors import SlackApiError

from switch_core.bridges.collaboration.slack.adapter import (
    SlackAdapter,
    SlackConnectionConfig,
)


def _run(coro: Any) -> Any:
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class FakeResponse(dict):
    """Stands in for a slack_sdk response, which is dict-like."""


class FakeWebClient:
    def __init__(self, groups: list[dict[str, Any]] | None = None) -> None:
        self.groups = groups or []
        self.created: list[dict[str, Any]] = []
        self.disabled: list[str] = []
        self.enabled: list[str] = []
        self.list_calls = 0
        self.create_error: str | None = None

    async def usergroups_list(self, **kwargs: Any) -> FakeResponse:
        self.list_calls += 1
        return FakeResponse({"usergroups": self.groups})

    async def usergroups_create(self, **kwargs: Any) -> FakeResponse:
        if self.create_error:
            raise SlackApiError(
                "create failed", FakeResponse({"error": self.create_error})
            )
        self.created.append(kwargs)
        group = {
            "id": f"S{len(self.created):03d}",
            "name": kwargs["name"],
            "handle": kwargs["handle"],
            "description": kwargs["description"],
        }
        self.groups.append(group)
        return FakeResponse({"usergroup": group})

    async def usergroups_disable(self, *, usergroup: str) -> FakeResponse:
        self.disabled.append(usergroup)
        return FakeResponse({"ok": True})

    async def usergroups_enable(self, *, usergroup: str) -> FakeResponse:
        self.enabled.append(usergroup)
        return FakeResponse({"ok": True})


def _adapter(
    *, enabled: bool = True, groups: list[dict[str, Any]] | None = None
) -> tuple[SlackAdapter, FakeWebClient]:
    adapter = SlackAdapter(
        config=SlackConnectionConfig(
            bot_token="xoxb-test",
            app_token="xapp-test",
            workspace_id="T123",
            agent_usergroups=enabled,
        )
    )
    client = FakeWebClient(groups)
    adapter._web_client = client  # type: ignore[assignment]
    return adapter, client


def _agent_group(group_id: str, name: str, *, disabled: bool = False) -> dict[str, Any]:
    group = {
        "id": group_id,
        "name": name,
        "handle": name.lower(),
        "description": f"Switch agent — {name} does things",
    }
    if disabled:
        group["date_delete"] = 1700000000
    return group


# ── Provisioning ─────────────────────────────────────────────────────────────


def test_creates_a_group_for_a_new_agent() -> None:
    adapter, client = _adapter()

    _run(adapter.create_agent_identity("flint-tracker", "Tracks flint"))

    assert len(client.created) == 1
    created = client.created[0]
    assert created["name"] == "flint-tracker"
    assert created["handle"] == "flint-tracker"
    assert created["description"].startswith("Switch agent — ")


def test_does_nothing_when_the_feature_is_off() -> None:
    adapter, client = _adapter(enabled=False)

    _run(adapter.create_agent_identity("flint-tracker", "Tracks flint"))

    assert client.created == []
    assert client.list_calls == 0


def test_provisioning_is_idempotent_for_an_existing_agent() -> None:
    adapter, client = _adapter(groups=[_agent_group("S001", "flint-tracker")])

    _run(adapter.create_agent_identity("flint-tracker", "Tracks flint"))

    assert client.created == []


def test_readding_an_agent_reenables_its_disabled_group() -> None:
    """Slack has no delete for user groups, so a removed agent's group is only
    disabled. Re-adding it must revive that group rather than collide with it."""
    adapter, client = _adapter(
        groups=[_agent_group("S001", "flint-tracker", disabled=True)]
    )

    _run(adapter.create_agent_identity("flint-tracker", "Tracks flint"))

    assert client.enabled == ["S001"]
    assert client.created == []
    assert adapter._agent_group_ids["flint-tracker"] == "S001"


def test_removing_an_agent_disables_its_group() -> None:
    adapter, client = _adapter(groups=[_agent_group("S001", "flint-tracker")])

    _run(adapter.remove_agent_identity("flint-tracker"))

    assert client.disabled == ["S001"]
    assert "flint-tracker" not in adapter._agent_group_ids


def test_workspace_groups_are_not_mistaken_for_agents() -> None:
    """A workspace's own group must never resolve to an agent — mentioning
    @designers would otherwise address whatever agent shared its name."""
    adapter, _ = _adapter(
        groups=[
            {
                "id": "S999",
                "name": "designers",
                "handle": "designers",
                "description": "The design team",
            }
        ]
    )

    _run(adapter._load_agent_usergroups())

    assert adapter._agent_group_ids == {}
    assert adapter._translate_usergroup_mentions("<!subteam^S999>") == "<!subteam^S999>"


def test_an_unusual_agent_name_still_yields_a_legal_handle() -> None:
    adapter, client = _adapter()

    _run(adapter.create_agent_identity("Flint Tracker!", "Tracks flint"))

    assert client.created[0]["handle"] == "flint-tracker"
    # The group's name keeps the agent name verbatim, so the mention still
    # resolves back to the agent even though the handle had to be folded.
    assert client.created[0]["name"] == "Flint Tracker!"


# ── Refusals stay loud ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "error,expected",
    [
        ("permission_denied", "restricts managing user"),
        ("plan_upgrade_required", "paid plan"),
        ("paid_teams_only", "paid plan"),
    ],
)
def test_refusals_raise_with_the_reason(error: str, expected: str) -> None:
    adapter, client = _adapter()
    client.create_error = error

    with pytest.raises(RuntimeError, match=expected):
        _run(adapter.create_agent_identity("flint-tracker", "Tracks flint"))


def test_a_handle_taken_by_someone_else_raises() -> None:
    adapter, client = _adapter()
    client.create_error = "handle_already_exists"

    with pytest.raises(RuntimeError, match="already taken"):
        _run(adapter.create_agent_identity("flint-tracker", "Tracks flint"))


def test_a_handle_taken_by_our_own_group_is_adopted() -> None:
    """A create can lose a race with our own earlier one; adopting the existing
    group is correct, and must not be reported as a collision."""
    adapter, client = _adapter()
    client.create_error = "handle_already_exists"
    client.groups = [_agent_group("S001", "flint-tracker")]

    _run(adapter.create_agent_identity("flint-tracker", "Tracks flint"))

    assert adapter._agent_group_ids["flint-tracker"] == "S001"


# ── Translation ──────────────────────────────────────────────────────────────


def test_inbound_group_mention_becomes_the_agent_name() -> None:
    adapter, _ = _adapter(groups=[_agent_group("S001", "flint-tracker")])
    _run(adapter._load_agent_usergroups())

    assert (
        adapter.translate_inbound("<!subteam^S001> please run the summary")
        == "@flint-tracker please run the summary"
    )


def test_inbound_group_mention_with_a_handle_label() -> None:
    adapter, _ = _adapter(groups=[_agent_group("S001", "flint-tracker")])
    _run(adapter._load_agent_usergroups())

    assert (
        adapter.translate_inbound("<!subteam^S001|@flint-tracker> hi")
        == "@flint-tracker hi"
    )


def test_inbound_resolves_to_the_agent_name_not_the_handle() -> None:
    """The handle may have been folded to be legal; addressing downstream
    matches on the agent's real name, so that is what must come out."""
    adapter, _ = _adapter(
        groups=[
            {
                "id": "S001",
                "name": "Flint.Tracker",
                "handle": "flint-tracker",
                "description": "Switch agent — tracks flint",
            }
        ]
    )
    _run(adapter._load_agent_usergroups())

    assert adapter.translate_inbound("<!subteam^S001> hi") == "@Flint.Tracker hi"


def test_unknown_group_mention_falls_back_to_its_label() -> None:
    adapter, _ = _adapter()

    assert (
        adapter._translate_usergroup_mentions("<!subteam^S999|@designers> ping")
        == "@designers ping"
    )


def test_outbound_agent_mention_renders_as_a_group_pill() -> None:
    adapter, _ = _adapter(groups=[_agent_group("S001", "flint-tracker")])
    _run(adapter._load_agent_usergroups())

    assert (
        adapter._translate_mentions_to_slack("hey @flint-tracker")
        == "hey <!subteam^S001>"
    )


def test_outbound_leaves_unknown_names_alone() -> None:
    adapter, _ = _adapter()

    assert adapter._translate_mentions_to_slack("hey @nobody") == "hey @nobody"


def test_outbound_prefers_a_real_person_over_an_agent_group() -> None:
    adapter, _ = _adapter(groups=[_agent_group("S001", "ambiguous")])
    _run(adapter._load_agent_usergroups())
    adapter.prime_mention_targets({"ambiguous": "U123"})

    assert adapter._translate_mentions_to_slack("@ambiguous") == "<@U123>"
