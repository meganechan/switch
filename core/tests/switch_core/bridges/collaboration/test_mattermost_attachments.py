from __future__ import annotations

import asyncio

from switch_core.bridges.collaboration.mattermost.adapter import (
    MattermostAdapter,
    MattermostConnectionConfig,
)


class _FakeFiles:
    """Stand-in for driver.files: canned metadata + bytes per file id."""

    def __init__(self, meta: dict[str, dict[str, object]], data: dict[str, bytes]):
        self._meta = meta
        self._data = data
        self.get_file_calls: list[str] = []

    def get_file_metadata(self, file_id: str) -> dict[str, object]:
        return self._meta[file_id]

    def get_file(self, file_id: str):  # noqa: ANN201 - mimics requests.Response
        self.get_file_calls.append(file_id)
        return type("_Resp", (), {"content": self._data[file_id]})()


def _adapter_with_files(files: _FakeFiles) -> MattermostAdapter:
    adapter = MattermostAdapter(
        config=MattermostConnectionConfig(
            url="http://mm",
            admin_user="admin",
            admin_password="pw",
            team_name="team",
        )
    )
    adapter._admin_driver = type("_Driver", (), {"files": files})()  # type: ignore[assignment]
    return adapter


def _fetch(adapter: MattermostAdapter, file_ids: list[str]):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(adapter._fetch_attachments(file_ids, loop))
    finally:
        loop.close()


def test_downloads_image_attachment() -> None:
    files = _FakeFiles(
        meta={"f1": {"mime_type": "image/png", "name": "cat.png", "size": 3}},
        data={"f1": b"abc"},
    )
    adapter = _adapter_with_files(files)

    attachments, failures = _fetch(adapter, ["f1"])

    assert failures == []
    assert len(attachments) == 1
    assert attachments[0].filename == "cat.png"
    assert attachments[0].mimetype == "image/png"
    assert attachments[0].data == b"abc"
    assert files.get_file_calls == ["f1"]


def test_downloads_non_image_attachment() -> None:
    files = _FakeFiles(
        meta={"f1": {"mime_type": "text/markdown", "name": "notes.md", "size": 7}},
        data={"f1": b"# notes"},
    )
    adapter = _adapter_with_files(files)

    attachments, failures = _fetch(adapter, ["f1"])

    # Every file type is relayed now — not just images.
    assert failures == []
    assert len(attachments) == 1
    assert attachments[0].filename == "notes.md"
    assert attachments[0].mimetype == "text/markdown"
    assert attachments[0].data == b"# notes"
    assert files.get_file_calls == ["f1"]


def test_failed_download_reported_as_failure() -> None:
    class _ExplodingFiles(_FakeFiles):
        def get_file_metadata(self, file_id: str) -> dict[str, object]:
            if file_id == "bad":
                raise RuntimeError("boom")
            return super().get_file_metadata(file_id)

    files = _ExplodingFiles(
        meta={"good": {"mime_type": "image/jpeg", "name": "ok.jpg", "size": 2}},
        data={"good": b"hi"},
    )
    adapter = _adapter_with_files(files)

    attachments, failures = _fetch(adapter, ["bad", "good"])

    # The good file still comes through; the bad one is disclosed, not dropped.
    assert [a.filename for a in attachments] == ["ok.jpg"]
    assert [f.filename for f in failures] == ["bad"]
    assert failures[0].reason


def test_oversize_attachment_reported_as_failure() -> None:
    files = _FakeFiles(
        meta={"f1": {"mime_type": "application/zip", "name": "huge.zip", "size": 100}},
        data={"f1": b"x" * 100},
    )
    adapter = _adapter_with_files(files)
    adapter.set_max_attachment_bytes(10)

    attachments, failures = _fetch(adapter, ["f1"])

    assert attachments == []
    assert files.get_file_calls == []
    assert [f.filename for f in failures] == ["huge.zip"]
    assert failures[0].reason


def test_multiple_files_all_returned() -> None:
    files = _FakeFiles(
        meta={
            "f1": {"mime_type": "image/png", "name": "cat.png", "size": 3},
            "f2": {"mime_type": "text/markdown", "name": "notes.md", "size": 7},
            "f3": {"mime_type": "application/pdf", "name": "doc.pdf", "size": 4},
        },
        data={"f1": b"abc", "f2": b"# notes", "f3": b"%PDF"},
    )
    adapter = _adapter_with_files(files)

    attachments, failures = _fetch(adapter, ["f1", "f2", "f3"])

    assert failures == []
    assert [a.filename for a in attachments] == ["cat.png", "notes.md", "doc.pdf"]
    assert [a.data for a in attachments] == [b"abc", b"# notes", b"%PDF"]


def test_no_file_ids_returns_empty() -> None:
    adapter = _adapter_with_files(_FakeFiles(meta={}, data={}))
    assert _fetch(adapter, []) == ([], [])


# ── Outbound attachments ─────────────────────────────────────────────────────


class _FakeUploadFiles:
    def __init__(self, *, fail: bool = False) -> None:
        self.uploads: list[tuple[str, dict[str, object]]] = []
        self._fail = fail

    def upload_file(self, channel_id: str, files: dict[str, object]):  # noqa: ANN201
        if self._fail:
            raise RuntimeError("upload boom")
        self.uploads.append((channel_id, files))
        return {"file_infos": [{"id": "fid-1"}]}


class _FakePosts:
    def __init__(self) -> None:
        self.posts: list[dict[str, object]] = []

    def create_post(self, post: dict[str, object]) -> dict[str, str]:
        self.posts.append(post)
        return {"id": "post-1"}


def _egress_adapter(
    *, upload_fail: bool = False
) -> tuple[MattermostAdapter, _FakeUploadFiles, _FakePosts]:
    adapter = MattermostAdapter(
        config=MattermostConnectionConfig(
            url="http://mm",
            admin_user="admin",
            admin_password="pw",
            team_name="team",
        )
    )
    files = _FakeUploadFiles(fail=upload_fail)
    posts = _FakePosts()
    driver = type("_Driver", (), {"files": files, "posts": posts})()
    adapter._bot_drivers["agent-a"] = driver  # type: ignore[assignment]
    return adapter, files, posts


def _send(adapter: MattermostAdapter, **kwargs: object):
    loop = asyncio.new_event_loop()
    try:

        async def go():
            adapter._main_loop = asyncio.get_event_loop()
            return await adapter.send_attachment(**kwargs)  # type: ignore[arg-type]

        return loop.run_until_complete(go())
    finally:
        loop.close()


def test_send_attachment_uploads_and_posts_as_agent_bot() -> None:
    adapter, files, posts = _egress_adapter()

    ref = _send(
        adapter,
        channel_id="chan-1",
        sender_name="agent-a",
        filename="plot.png",
        mimetype="image/png",
        data=b"bytes",
        caption="the plot",
        thread_root_id="root-post",
    )

    assert ref == "post-1"
    assert len(files.uploads) == 1
    channel_id, upload_files = files.uploads[0]
    assert channel_id == "chan-1"
    filename, blob, mimetype = upload_files["files"]  # type: ignore[misc]
    assert filename == "plot.png"
    assert blob.read() == b"bytes"
    assert mimetype == "image/png"
    assert posts.posts == [
        {
            "channel_id": "chan-1",
            "message": "the plot",
            "file_ids": ["fid-1"],
            "root_id": "root-post",
        }
    ]


def test_send_attachment_without_caption_or_thread() -> None:
    adapter, _files, posts = _egress_adapter()

    ref = _send(
        adapter,
        channel_id="chan-1",
        sender_name="agent-a",
        filename="cat.png",
        mimetype="image/png",
        data=b"x",
    )

    assert ref == "post-1"
    assert posts.posts[0]["message"] == ""
    assert "root_id" not in posts.posts[0]


def test_send_attachment_upload_failure_falls_back_to_disclosed_text() -> None:
    adapter, files, posts = _egress_adapter(upload_fail=True)

    ref = _send(
        adapter,
        channel_id="chan-1",
        sender_name="agent-a",
        filename="cat.png",
        mimetype="image/png",
        data=b"x",
        caption="look",
    )

    # The failure surfaces as a visible text post, never a silent drop.
    assert ref == "post-1"
    assert files.uploads == []
    assert len(posts.posts) == 1
    message = str(posts.posts[0]["message"])
    assert "couldn't be relayed" in message
    assert "cat.png" in message
    assert "file_ids" not in posts.posts[0]
