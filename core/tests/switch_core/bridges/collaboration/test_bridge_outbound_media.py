from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import nio
from nio import DownloadError

from switch_core.bridges.collaboration.bridge_core import BridgeCore


def _media_event(
    *,
    msgtype: str = "m.image",
    body: str = "cat.png",
    filename: str | None = None,
    sender: str = "@agent:s",
    sender_name: str | None = "agent-a",
    thread_root: str | None = None,
) -> nio.RoomMessageMedia:
    content: dict[str, Any] = {
        "msgtype": msgtype,
        "body": body,
        "url": "mxc://s/abc",
        "info": {"mimetype": "image/png", "size": 5},
    }
    if filename is not None:
        content["filename"] = filename
    if sender_name is not None:
        content["sender_name"] = sender_name
    if thread_root is not None:
        content["m.relates_to"] = {"rel_type": "m.thread", "event_id": thread_root}
    cls = nio.RoomMessageImage if msgtype == "m.image" else nio.RoomMessageFile
    return cls.from_dict(
        {
            "type": "m.room.message",
            "event_id": "$media-event",
            "sender": sender,
            "origin_server_ts": 1700000000000,
            "content": content,
        }
    )


class _FakeAdapter:
    def __init__(self) -> None:
        self.attachments: list[dict[str, Any]] = []
        self.messages: list[dict[str, Any]] = []

    async def send_attachment(
        self,
        channel_id,
        sender_name,
        filename,
        mimetype,
        data,
        caption=None,
        thread_root_id=None,
    ):  # noqa: ANN001, ANN201
        self.attachments.append(
            {
                "channel_id": channel_id,
                "sender_name": sender_name,
                "filename": filename,
                "mimetype": mimetype,
                "data": data,
                "caption": caption,
                "thread_root_id": thread_root_id,
            }
        )
        return "ext-ref-1"

    async def send_message(self, channel_id, sender_name, content, thread_root_id=None):  # noqa: ANN001, ANN201
        self.messages.append(
            {
                "channel_id": channel_id,
                "sender_name": sender_name,
                "content": content,
                "thread_root_id": thread_root_id,
            }
        )
        return "ext-ref-2"

    def translate_outbound(self, content: str) -> str:
        return content


def _fake_bridge(
    *,
    download: object = SimpleNamespace(body=b"bytes"),
    matrix_to_external: dict[str, str] | None = None,
    max_bytes: int = 1024,
) -> SimpleNamespace:
    adapter = _FakeAdapter()
    recorded: list[dict[str, str]] = []
    lookup = matrix_to_external or {}

    async def _external_post_for_matrix_event(matrix_event_id: str) -> str | None:
        return lookup.get(matrix_event_id)

    async def _record_message_map(**kwargs: str) -> None:
        recorded.append(kwargs)

    ns = SimpleNamespace(
        _adapter=adapter,
        _puppet_matrix_ids={"@puppet:s"},
        _bridge_client_matrix_user_id="@bridge:s",
        _max_attachment_bytes=max_bytes,
        _external_post_for_matrix_event=_external_post_for_matrix_event,
        _record_message_map=_record_message_map,
        recorded=recorded,
    )
    ns._find_channel = lambda room_id=None, matrix_room_id=None: (
        "chan-1" if matrix_room_id == "!room:s" else None
    )
    ns._outbound_thread_root_ref = BridgeCore._outbound_thread_root_ref.__get__(ns)
    ns._download_matrix_media = BridgeCore._download_matrix_media.__get__(ns)

    async def _nio_download(mxc: str):
        return download

    ns.client = SimpleNamespace(nio_client=SimpleNamespace(download=_nio_download))
    return ns


def _room() -> SimpleNamespace:
    return SimpleNamespace(room_id="!room:s")


async def test_image_relays_via_send_attachment_and_records_map() -> None:
    bridge = _fake_bridge()

    await BridgeCore.handle_outbound_media(
        bridge, _room(), _media_event(), bridge.client
    )

    assert bridge._adapter.attachments == [
        {
            "channel_id": "chan-1",
            "sender_name": "agent-a",
            "filename": "cat.png",
            "mimetype": "image/png",
            "data": b"bytes",
            "caption": None,
            "thread_root_id": None,
        }
    ]
    assert bridge.recorded == [
        {
            "external_channel_id": "chan-1",
            "matrix_event_id": "$media-event",
            "external_post_id": "ext-ref-1",
        }
    ]


async def test_caption_convention_unpacks_body_and_filename() -> None:
    bridge = _fake_bridge()

    await BridgeCore.handle_outbound_media(
        bridge,
        _room(),
        _media_event(body="look at this", filename="plot.png"),
        bridge.client,
    )

    sent = bridge._adapter.attachments[0]
    assert sent["filename"] == "plot.png"
    assert sent["caption"] == "look at this"


async def test_threaded_media_resolves_external_root() -> None:
    bridge = _fake_bridge(matrix_to_external={"$root": "ext-root"})

    await BridgeCore.handle_outbound_media(
        bridge, _room(), _media_event(thread_root="$root"), bridge.client
    )

    assert bridge._adapter.attachments[0]["thread_root_id"] == "ext-root"


async def test_puppet_media_is_skipped() -> None:
    # Media a puppet posted originated on the platform — relaying it back
    # would echo it.
    bridge = _fake_bridge()

    await BridgeCore.handle_outbound_media(
        bridge, _room(), _media_event(sender="@puppet:s"), bridge.client
    )

    assert bridge._adapter.attachments == []
    assert bridge._adapter.messages == []


async def test_media_without_sender_name_is_skipped() -> None:
    bridge = _fake_bridge()

    await BridgeCore.handle_outbound_media(
        bridge, _room(), _media_event(sender_name=None), bridge.client
    )

    assert bridge._adapter.attachments == []
    assert bridge._adapter.messages == []


async def test_non_image_file_posts_disclosed_notice() -> None:
    bridge = _fake_bridge()

    await BridgeCore.handle_outbound_media(
        bridge,
        _room(),
        _media_event(msgtype="m.file", body="report.pdf"),
        bridge.client,
    )

    assert bridge._adapter.attachments == []
    assert len(bridge._adapter.messages) == 1
    assert "report.pdf" in bridge._adapter.messages[0]["content"]
    # The notice still threads/correlates like a real relay.
    assert bridge.recorded[0]["external_post_id"] == "ext-ref-2"


async def test_download_failure_posts_disclosed_fallback() -> None:
    bridge = _fake_bridge(download=DownloadError("boom"))

    await BridgeCore.handle_outbound_media(
        bridge, _room(), _media_event(), bridge.client
    )

    assert bridge._adapter.attachments == []
    assert len(bridge._adapter.messages) == 1
    assert "couldn't be relayed" in bridge._adapter.messages[0]["content"]


async def test_oversize_media_posts_disclosed_fallback() -> None:
    bridge = _fake_bridge(download=SimpleNamespace(body=b"too big"), max_bytes=3)

    await BridgeCore.handle_outbound_media(
        bridge, _room(), _media_event(), bridge.client
    )

    assert bridge._adapter.attachments == []
    assert "couldn't be relayed" in bridge._adapter.messages[0]["content"]
