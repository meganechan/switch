from __future__ import annotations

import pytest
from nio import UploadError

from switch_core.clients.client_base import ClientBase


class _FakeSendResp:
    def __init__(self, event_id: str) -> None:
        self.event_id = event_id


class _FakeUploadResp:
    def __init__(self, content_uri: str) -> None:
        self.content_uri = content_uri


class _FakeNio:
    def __init__(self, *, upload_result: object) -> None:
        self._upload_result = upload_result
        self.room_send_calls: list[tuple[str, str, dict]] = []
        self.upload_calls: list[dict] = []

    async def room_send(self, room_id: str, msgtype: str, content: dict):
        self.room_send_calls.append((room_id, msgtype, content))
        return _FakeSendResp("$evt")

    async def upload(self, **kwargs):  # noqa: ANN003
        self.upload_calls.append(kwargs)
        return self._upload_result, None


def _client(nio: _FakeNio) -> ClientBase:
    client = object.__new__(ClientBase)
    client.nio_client = nio  # type: ignore[attr-defined]
    client.display_name = "Alice"  # type: ignore[attr-defined]
    return client


async def test_upload_media_returns_content_uri() -> None:
    nio = _FakeNio(upload_result=_FakeUploadResp("mxc://s/abc"))
    client = _client(nio)

    mxc = await client.upload_media(b"bytes", "image/png", "cat.png")

    assert mxc == "mxc://s/abc"
    assert nio.upload_calls[0]["content_type"] == "image/png"
    assert nio.upload_calls[0]["filename"] == "cat.png"
    assert nio.upload_calls[0]["filesize"] == 5


async def test_upload_media_raises_on_error() -> None:
    nio = _FakeNio(upload_result=UploadError("nope"))
    client = _client(nio)

    with pytest.raises(RuntimeError, match="Failed to upload media"):
        await client.upload_media(b"bytes", "image/png", "cat.png")


async def test_send_media_with_caption_sets_body_and_filename() -> None:
    nio = _FakeNio(upload_result=_FakeUploadResp("mxc://s/abc"))
    client = _client(nio)

    event_id = await client.send_media(
        "!room",
        "mxc://s/abc",
        "cat.png",
        "image/png",
        1234,
        msgtype="m.image",
        caption="look at this",
    )

    assert event_id == "$evt"
    _, msgtype, content = nio.room_send_calls[0]
    assert msgtype == "m.room.message"
    assert content["msgtype"] == "m.image"
    # Caption convention: body is the caption, filename carried separately.
    assert content["body"] == "look at this"
    assert content["filename"] == "cat.png"
    assert content["url"] == "mxc://s/abc"
    assert content["info"] == {"mimetype": "image/png", "size": 1234}
    assert content["sender_name"] == "Alice"


async def test_send_media_without_caption_uses_filename_as_body() -> None:
    nio = _FakeNio(upload_result=_FakeUploadResp("mxc://s/abc"))
    client = _client(nio)

    await client.send_media(
        "!room", "mxc://s/abc", "cat.png", "image/png", 1234, msgtype="m.image"
    )

    _, _, content = nio.room_send_calls[0]
    assert content["body"] == "cat.png"
    assert "filename" not in content
