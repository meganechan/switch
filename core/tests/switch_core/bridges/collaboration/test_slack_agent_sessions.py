"""Slack's native agent session status, mirrored alongside Switch's own.

This is additive: the posted "working on it…" message is what carries the
detail and is unchanged. The session adds Slack's own loading UX and its stop
button — and a stop button that does nothing would be worse than none, so the
routing of that button is covered here too.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from slack_sdk.errors import SlackApiError

from switch_core.bridges.collaboration.models import InboundCommand
from switch_core.bridges.collaboration.slack.adapter import (
    SlackAdapter,
    SlackConnectionConfig,
    SlackUser,
)


def _run(coro: Any) -> Any:
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class FakeResponse(dict):
    pass


class FakeWebClient:
    def __init__(self) -> None:
        self.api_calls: list[tuple[str, dict[str, Any]]] = []
        self.posted: list[dict[str, Any]] = []
        self.deleted: list[dict[str, Any]] = []
        self.api_error: str | None = None
        self._ts = 0

    async def api_call(self, method: str, **kwargs: Any) -> FakeResponse:
        if self.api_error:
            raise SlackApiError("failed", FakeResponse({"error": self.api_error}))
        self.api_calls.append((method, kwargs))
        return FakeResponse({"ok": True})

    async def chat_postMessage(self, **kwargs: Any) -> FakeResponse:
        self._ts += 1
        self.posted.append(kwargs)
        return FakeResponse({"ts": f"{self._ts}.0"})

    async def chat_delete(self, **kwargs: Any) -> FakeResponse:
        self.deleted.append(kwargs)
        return FakeResponse({"ok": True})

    async def chat_update(self, **kwargs: Any) -> FakeResponse:
        return FakeResponse({"ok": True})

    async def conversations_info(self, **kwargs: Any) -> FakeResponse:
        return FakeResponse({"channel": {"is_private": False}})


def _adapter(*, enabled: bool = True) -> tuple[SlackAdapter, FakeWebClient]:
    adapter = SlackAdapter(
        config=SlackConnectionConfig(
            bot_token="xoxb-test",
            app_token="xapp-test",
            workspace_id="T123",
            agent_sessions=enabled,
        )
    )
    client = FakeWebClient()
    adapter._web_client = client  # type: ignore[assignment]
    adapter._channel_type_cache["C1"] = "channel"
    return adapter, client


def _statuses(client: FakeWebClient) -> list[str]:
    return [
        str(kwargs["json"]["status"])
        for method, kwargs in client.api_calls
        if method == "agents.sessions.setStatus"
    ]


# ── Mirroring the turn ───────────────────────────────────────────────────────


def test_working_in_a_thread_sets_the_session_processing() -> None:
    adapter, client = _adapter()

    _run(
        adapter.apply_runtime_state(
            "C1",
            "flint-tracker",
            "working",
            mention_handle=None,
            thread_root_id="C1:111.0",
        )
    )

    assert _statuses(client) == ["processing"]
    payload = client.api_calls[0][1]["json"]
    assert payload["channel_id"] == "C1"
    assert payload["thread_ts"] == "111.0"
    # The session carries the agent's identity, not the app's — one app fronts
    # every agent, so an unnamed status would be ambiguous.
    assert payload["username"] == "flint-tracker"


def test_going_idle_clears_the_session() -> None:
    adapter, client = _adapter()

    _run(
        adapter.apply_runtime_state(
            "C1",
            "flint-tracker",
            "working",
            mention_handle=None,
            thread_root_id="C1:111.0",
        )
    )
    _run(
        adapter.apply_runtime_state(
            "C1",
            "flint-tracker",
            "idle",
            mention_handle=None,
            thread_root_id="C1:111.0",
        )
    )

    assert _statuses(client) == ["processing", "active"]


def test_awaiting_input_stays_processing() -> None:
    """The agent is mid-turn, just paused — the same as the posted indicator,
    which deliberately stays up through awaiting-input."""
    adapter, client = _adapter()

    _run(
        adapter.apply_runtime_state(
            "C1",
            "flint-tracker",
            "awaiting-input",
            mention_handle=None,
            thread_root_id="C1:111.0",
        )
    )

    assert _statuses(client) == ["processing"]


def test_a_turn_at_the_channel_root_sets_no_session() -> None:
    """A session is scoped to a thread, so a root-level turn has nowhere to
    attach one and is left to the posted messages alone."""
    adapter, client = _adapter()

    _run(
        adapter.apply_runtime_state(
            "C1", "flint-tracker", "working", mention_handle=None, thread_root_id=None
        )
    )

    assert _statuses(client) == []
    # The ordinary indicator is unaffected — this feature only ever adds.
    assert len(client.posted) == 1


def test_the_posted_indicator_is_unchanged_when_sessions_are_off() -> None:
    adapter, client = _adapter(enabled=False)

    _run(
        adapter.apply_runtime_state(
            "C1",
            "flint-tracker",
            "working",
            mention_handle=None,
            thread_root_id="C1:111.0",
        )
    )

    assert client.api_calls == []
    assert len(client.posted) == 1


# ── Refusals ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "error,expected",
    [
        ("not_an_agent", "not declared as an Agent"),
        ("missing_scope", "assistant:write"),
        ("unknown_method", "does not offer"),
    ],
)
def test_a_refusal_is_reported_once_and_not_retried(
    error: str, expected: str, caplog: pytest.LogCaptureFixture
) -> None:
    adapter, client = _adapter()
    client.api_error = error

    with caplog.at_level("WARNING"):
        for _ in range(3):
            _run(
                adapter.apply_runtime_state(
                    "C1",
                    "flint-tracker",
                    "working",
                    mention_handle=None,
                    thread_root_id="C1:111.0",
                )
            )

    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert len(warnings) == 1
    assert expected in warnings[0].getMessage()


def test_a_refusal_does_not_stop_the_turn_being_shown() -> None:
    """Losing the native status must never cost the status we post ourselves."""
    adapter, client = _adapter()
    client.api_error = "not_an_agent"

    _run(
        adapter.apply_runtime_state(
            "C1",
            "flint-tracker",
            "working",
            mention_handle=None,
            thread_root_id="C1:111.0",
        )
    )

    assert len(client.posted) == 1


def test_a_one_off_failure_is_logged_but_not_latched(
    caplog: pytest.LogCaptureFixture,
) -> None:
    adapter, client = _adapter()
    client.api_error = "internal_error"

    with caplog.at_level("WARNING"):
        _run(
            adapter.apply_runtime_state(
                "C1",
                "flint-tracker",
                "working",
                mention_handle=None,
                thread_root_id="C1:111.0",
            )
        )

    assert adapter._agent_sessions_off_reason is None
    assert any("Could not set" in r.getMessage() for r in caplog.records)


# ── The stop button ──────────────────────────────────────────────────────────


def test_stop_interrupts_the_agent_whose_turn_it_is() -> None:
    adapter, _ = _adapter()
    commands: list[InboundCommand] = []

    async def on_command(cmd: InboundCommand) -> None:
        commands.append(cmd)

    adapter._on_command = on_command  # type: ignore[assignment]
    adapter._user_cache["U1"] = SlackUser(name="louis", display_name="Louis")

    _run(
        adapter.apply_runtime_state(
            "C1",
            "flint-tracker",
            "working",
            mention_handle=None,
            thread_root_id="C1:111.0",
        )
    )
    _run(
        adapter._handle_session_stopped(
            {"channel_id": "C1", "thread_ts": "111.0", "user_id": "U1"}
        )
    )

    assert len(commands) == 1
    assert commands[0].command == "interrupt"
    assert commands[0].args == "@flint-tracker"
    assert commands[0].sender_name == "louis"


def test_stop_with_no_live_turn_does_nothing() -> None:
    adapter, _ = _adapter()
    commands: list[InboundCommand] = []

    async def on_command(cmd: InboundCommand) -> None:
        commands.append(cmd)

    adapter._on_command = on_command  # type: ignore[assignment]

    _run(
        adapter._handle_session_stopped(
            {"channel_id": "C1", "thread_ts": "999.0", "user_id": "U1"}
        )
    )

    assert commands == []


def test_a_finished_turn_no_longer_answers_the_stop_button() -> None:
    """The owner is dropped when the turn ends, so a late press cannot
    interrupt whatever the agent has moved on to."""
    adapter, _ = _adapter()
    commands: list[InboundCommand] = []

    async def on_command(cmd: InboundCommand) -> None:
        commands.append(cmd)

    adapter._on_command = on_command  # type: ignore[assignment]

    _run(
        adapter.apply_runtime_state(
            "C1",
            "flint-tracker",
            "working",
            mention_handle=None,
            thread_root_id="C1:111.0",
        )
    )
    _run(
        adapter.apply_runtime_state(
            "C1",
            "flint-tracker",
            "idle",
            mention_handle=None,
            thread_root_id="C1:111.0",
        )
    )
    _run(
        adapter._handle_session_stopped(
            {"channel_id": "C1", "thread_ts": "111.0", "user_id": "U1"}
        )
    )

    assert commands == []


def test_not_authorized_latches_immediately() -> None:
    """The code the pilot actually returned. It was missing from the list, so
    the warning fired on every turn instead of once."""
    adapter, client = _adapter()
    client.api_error = "not_authorized"

    _run(
        adapter.apply_runtime_state(
            "C1",
            "flint-tracker",
            "working",
            mention_handle=None,
            thread_root_id="C1:111.0",
        )
    )

    assert adapter._agent_sessions_off_reason == "not_authorized"


def test_an_unknown_refusal_gives_up_after_a_few_tries(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A code this build does not recognise cannot be told from a passing fault
    at first sight, so it is retried — but it must not warn forever."""
    adapter, client = _adapter()
    client.api_error = "some_code_we_have_never_seen"

    with caplog.at_level("WARNING"):
        for _ in range(6):
            _run(
                adapter.apply_runtime_state(
                    "C1",
                    "flint-tracker",
                    "working",
                    mention_handle=None,
                    thread_root_id="C1:111.0",
                )
            )

    assert adapter._agent_sessions_off_reason == "some_code_we_have_never_seen"
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    # Three attempts, then the one that says it is giving up — not six.
    assert len(warnings) == 4
    assert any("kept refusing" in r.getMessage() for r in warnings)


def test_a_success_resets_the_failure_count() -> None:
    """An intermittent fault must not accumulate towards giving up."""
    adapter, client = _adapter()

    for _ in range(2):
        client.api_error = "transient"
        _run(
            adapter.apply_runtime_state(
                "C1",
                "flint-tracker",
                "working",
                mention_handle=None,
                thread_root_id="C1:111.0",
            )
        )
        client.api_error = None
        _run(
            adapter.apply_runtime_state(
                "C1",
                "flint-tracker",
                "idle",
                mention_handle=None,
                thread_root_id="C1:111.0",
            )
        )

    assert adapter._agent_sessions_off_reason is None
