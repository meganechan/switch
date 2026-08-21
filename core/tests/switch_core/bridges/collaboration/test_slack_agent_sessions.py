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

_TRACE_MARKER = "[agent-sessions]"


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
        if method == "chat.startStream":
            self._ts += 1
            return FakeResponse({"ok": True, "ts": f"stream-{self._ts}"})
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

    async def users_info(self, **kwargs: Any) -> FakeResponse:
        return FakeResponse({"user": {"name": "someone", "profile": {}}})


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
    # Learned from auth_test at startup. On an Enterprise Grid org this is not
    # the configured workspace id, which is the org (`E…`) rather than the team.
    adapter._team_id = "T02TEAM"
    # Streaming into a channel names who is being replied to; in life this is
    # recorded from the message that started the turn.
    adapter._thread_requester[("C1", "111.0")] = "U1"
    adapter._thread_requester[("C1", "222.0")] = "U1"
    return adapter, client


def _methods(client: FakeWebClient) -> list[str]:
    return [method for method, _ in client.api_calls]


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
    payload = next(
        p["json"] for m, p in client.api_calls if m == "agents.sessions.setStatus"
    )
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
        settled = len([r for r in caplog.records if r.levelname == "WARNING"])
        for _ in range(5):
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
    # The point is that it stops: further turns add nothing to the log.
    assert len(warnings) == settled
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


# ── Not resending an unchanged status ────────────────────────────────────────


def test_a_repeated_working_state_is_not_resent() -> None:
    """Runtime state is reported through a turn, not only when it changes. One
    long turn was re-sending the same status to Slack every few seconds."""
    adapter, client = _adapter()

    for _ in range(5):
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


def test_a_change_is_still_sent() -> None:
    adapter, client = _adapter()

    for state in ("working", "working", "idle", "working"):
        _run(
            adapter.apply_runtime_state(
                "C1",
                "flint-tracker",
                state,
                mention_handle=None,
                thread_root_id="C1:111.0",
            )
        )

    assert _statuses(client) == ["processing", "active", "processing"]


def test_a_long_turn_refreshes_before_slack_drops_it() -> None:
    """Slack drops a processing session after an hour, so silence for the whole
    turn would lose the indicator on anything long-running."""
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
    # Pretend the turn has been going for a while.
    adapter._session_status[("C1", "111.0")] = ("processing", 0.0)
    _run(
        adapter.apply_runtime_state(
            "C1",
            "flint-tracker",
            "working",
            mention_handle=None,
            thread_root_id="C1:111.0",
        )
    )

    assert _statuses(client) == ["processing", "processing"]


def test_separate_threads_keep_separate_status() -> None:
    adapter, client = _adapter()

    for thread in ("C1:111.0", "C1:222.0"):
        _run(
            adapter.apply_runtime_state(
                "C1",
                "flint-tracker",
                "working",
                mention_handle=None,
                thread_root_id=thread,
            )
        )

    assert _statuses(client) == ["processing", "processing"]


def test_a_refused_send_is_retried_not_remembered() -> None:
    """Recording the status before Slack accepted it would mean a refusal was
    never retried — and the give-up counter would never reach its limit."""
    adapter, client = _adapter()
    client.api_error = "transient"

    for _ in range(2):
        _run(
            adapter.apply_runtime_state(
                "C1",
                "flint-tracker",
                "working",
                mention_handle=None,
                thread_root_id="C1:111.0",
            )
        )

    assert adapter._session_status == {}
    assert adapter._session_failures > 0


# ── The stream that creates the session ──────────────────────────────────────


def _working(
    adapter: SlackAdapter, detail: str | None = None, thread: str = "C1:111.0"
):
    return adapter.apply_runtime_state(
        "C1",
        "flint-tracker",
        "working",
        mention_handle=None,
        thread_root_id=thread,
        detail=detail,
    )


def test_a_turn_opens_a_stream_before_setting_status() -> None:
    """Setting a status without a session is accepted and renders nothing —
    which is exactly how the first version looked healthy while doing nothing.
    The stream is what creates the session, so it has to come first."""
    adapter, client = _adapter()

    _run(_working(adapter, "reading the codebase"))

    methods = _methods(client)
    assert methods[0] == "chat.startStream"
    assert "agents.sessions.setStatus" in methods
    assert methods.index("chat.startStream") < methods.index(
        "agents.sessions.setStatus"
    )


def test_the_stream_names_the_agent_and_the_person_asking() -> None:
    adapter, client = _adapter()

    _run(_working(adapter))

    payload = next(p["json"] for m, p in client.api_calls if m == "chat.startStream")
    assert payload["thread_ts"] == "111.0"
    assert payload["recipient_user_id"] == "U1"
    assert payload["username"] == "flint-tracker"


def test_each_new_activity_is_pushed_as_a_step() -> None:
    adapter, client = _adapter()

    _run(_working(adapter, "reading the codebase"))
    _run(_working(adapter, "running the tests"))

    appended = [p["json"] for m, p in client.api_calls if m == "chat.appendStream"]
    titles = [a["chunks"][0]["title"] for a in appended]
    assert titles == ["reading the codebase", "running the tests"]


def test_the_same_activity_is_not_pushed_twice() -> None:
    """Runtime state repeats through a turn; only a change is worth sending."""
    adapter, client = _adapter()

    for _ in range(4):
        _run(_working(adapter, "reading the codebase"))

    appended = [m for m in _methods(client) if m == "chat.appendStream"]
    assert len(appended) == 1


def test_the_stream_is_closed_when_the_turn_ends() -> None:
    adapter, client = _adapter()

    _run(_working(adapter, "reading the codebase"))
    _run(
        adapter.apply_runtime_state(
            "C1",
            "flint-tracker",
            "idle",
            mention_handle=None,
            thread_root_id="C1:111.0",
        )
    )

    assert "chat.stopStream" in _methods(client)
    assert adapter._stream_ts == {}
    assert adapter._stream_step == {}


def test_a_second_turn_opens_a_fresh_stream() -> None:
    adapter, client = _adapter()

    _run(_working(adapter, "first"))
    _run(
        adapter.apply_runtime_state(
            "C1",
            "flint-tracker",
            "idle",
            mention_handle=None,
            thread_root_id="C1:111.0",
        )
    )
    _run(_working(adapter, "second"))

    assert _methods(client).count("chat.startStream") == 2


def test_no_stream_without_someone_to_stream_to() -> None:
    """Streaming into a channel requires naming the recipient, so a thread we
    never saw a question on cannot be streamed to."""
    adapter, client = _adapter()
    adapter._thread_requester.clear()

    _run(_working(adapter, "reading the codebase"))

    assert "chat.startStream" not in _methods(client)


def test_a_refused_stream_does_not_leave_a_phantom_open() -> None:
    adapter, client = _adapter()
    client.api_error = "not_authorized"

    _run(_working(adapter, "reading the codebase"))

    assert adapter._stream_ts == {}


def test_the_requester_is_recorded_from_an_incoming_message() -> None:
    adapter, _ = _adapter()
    adapter._thread_requester.clear()
    adapter._bot_user_id = "UBOT"

    _run(
        adapter._handle_message_event(
            {
                "channel": "C1",
                "ts": "333.0",
                "user": "U9",
                "text": "hi",
                "channel_type": "channel",
            }
        )
    )

    assert adapter._thread_requester[("C1", "333.0")] == "U9"


def test_the_stream_names_the_team_not_the_configured_workspace() -> None:
    """Slack rejects the open without a team id. On an Enterprise Grid org the
    configured workspace id is the org (`E…`), not the team (`T…`), so it comes
    from the authenticated identity instead."""
    adapter, client = _adapter()

    _run(_working(adapter, "reading"))

    payload = next(p["json"] for m, p in client.api_calls if m == "chat.startStream")
    assert payload["recipient_team_id"] == "T02TEAM"


def test_no_stream_before_the_team_id_is_known() -> None:
    """Better no session than one Slack will refuse for a field we could have
    supplied."""
    adapter, client = _adapter()
    adapter._team_id = ""

    _run(_working(adapter, "reading"))

    assert "chat.startStream" not in _methods(client)


def test_a_threadless_agent_is_only_reported_once(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The trace must not bury the log: one night of per-turn skips produced
    eleven thousand lines."""
    adapter, _ = _adapter()

    with caplog.at_level("INFO"):
        for _ in range(20):
            _run(
                adapter.apply_runtime_state(
                    "C1",
                    "flint-tracker",
                    "working",
                    mention_handle=None,
                    thread_root_id=None,
                )
            )

    lines = [r for r in caplog.records if "no thread for" in r.getMessage()]
    assert len(lines) == 1


def test_a_given_up_session_says_nothing_further(
    caplog: pytest.LogCaptureFixture,
) -> None:
    adapter, _ = _adapter()
    adapter._agent_sessions_off_reason = "not_authorized"

    with caplog.at_level("INFO"):
        for _ in range(20):
            _run(_working(adapter, "reading"))

    assert [r for r in caplog.records if _TRACE_MARKER in r.getMessage()] == []
