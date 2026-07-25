from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from switch_core.bridges.collaboration.bridge_core import BridgeCore

# When the Switch app is invited to (or addressed in) a bridged channel that has
# no room yet, a room is auto-created even if no agent can be associated with it
# (Slack is a single-app bridge). In that agentless case the bridge posts an
# admin notice into the channel explaining the room has no agents and how to
# invite one — posted after create_room returns, so it follows the bridge
# client's invite into the room.


def _fake_bridge(*, agent_ids: list[str]):  # noqa: ANN202
    notices: list[tuple[str, str, str | None]] = []
    room = SimpleNamespace(id="room-uuid", matrix_room_id="!m:switch.local")

    class _Adapter:
        async def admin_message(
            self,
            channel_id: str,
            content: str,
            thread_root_id: str | None = None,
            *,
            message_type: str | None = None,
        ) -> str:
            notices.append((channel_id, content, message_type))
            return "C123:999.9"

    class _RoomService:
        def __init__(self) -> None:
            self.configs: list[Any] = []

        async def create_room(self, config: Any) -> SimpleNamespace:
            self.configs.append(config)
            return SimpleNamespace(room=room)

    async def _resolve_agents_for_channel(
        channel_id: str, channel_type: str
    ) -> list[str]:
        return agent_ids

    def add_room_mapping(room_id: str, matrix_room_id: str, channel_id: str) -> None:
        pass

    async def _adopt_existing_room(channel_id: str) -> tuple[str, str] | None:
        return None

    return SimpleNamespace(
        _adapter=_Adapter(),
        _room_service=_RoomService(),
        _resolve_agents_for_channel=_resolve_agents_for_channel,
        _adopt_existing_room=_adopt_existing_room,
        add_room_mapping=add_room_mapping,
        _provisioning_channels=set(),
        _channel_to_room={},
        _bridge_display_name="Switch",
        _bridge_id="bridge-1",
        notices=notices,
    )


async def test_agentless_auto_create_posts_notice() -> None:
    bridge = _fake_bridge(agent_ids=[])

    result = await BridgeCore._create_room_for_channel(
        bridge,
        channel_id="C0BGC39BFSR",
        channel_type="channel_public",
        channel_name="general",
    )

    assert result == ("room-uuid", "!m:switch.local")
    # A room was still created despite having no agents (no hard failure).
    assert len(bridge._room_service.configs) == 1
    assert bridge._room_service.configs[0].agent_ids == []
    # The no-agents notice is posted to the originating channel.
    assert len(bridge.notices) == 1
    channel_id, content, message_type = bridge.notices[0]
    assert channel_id == "C0BGC39BFSR"
    assert message_type == "no_agents"
    assert "no agents" in content.lower()
    assert "!invite-agent" in content


async def test_auto_create_with_agents_posts_no_notice() -> None:
    bridge = _fake_bridge(agent_ids=["a1"])

    result = await BridgeCore._create_room_for_channel(
        bridge,
        channel_id="C0BGC39BFSR",
        channel_type="channel_public",
        channel_name="general",
    )

    assert result == ("room-uuid", "!m:switch.local")
    assert bridge._room_service.configs[0].agent_ids == ["a1"]
    assert bridge.notices == []
