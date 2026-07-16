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
        return loop.run_until_complete(adapter._fetch_image_attachments(file_ids, loop))
    finally:
        loop.close()


def test_downloads_image_attachment() -> None:
    files = _FakeFiles(
        meta={"f1": {"mime_type": "image/png", "name": "cat.png", "size": 3}},
        data={"f1": b"abc"},
    )
    adapter = _adapter_with_files(files)

    attachments = _fetch(adapter, ["f1"])

    assert len(attachments) == 1
    assert attachments[0].filename == "cat.png"
    assert attachments[0].mimetype == "image/png"
    assert attachments[0].data == b"abc"
    assert files.get_file_calls == ["f1"]


def test_skips_non_image_attachment() -> None:
    files = _FakeFiles(
        meta={"f1": {"mime_type": "application/pdf", "name": "doc.pdf", "size": 9}},
        data={"f1": b"%PDF"},
    )
    adapter = _adapter_with_files(files)

    attachments = _fetch(adapter, ["f1"])

    # Non-image is skipped entirely — and we never download its bytes.
    assert attachments == []
    assert files.get_file_calls == []


def test_failed_download_skips_only_that_file() -> None:
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

    attachments = _fetch(adapter, ["bad", "good"])

    assert [a.filename for a in attachments] == ["ok.jpg"]


def test_no_file_ids_returns_empty() -> None:
    adapter = _adapter_with_files(_FakeFiles(meta={}, data={}))
    assert _fetch(adapter, []) == []
