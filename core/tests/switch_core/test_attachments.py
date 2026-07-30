from __future__ import annotations

from typing import Any

import pytest

from switch_core.attachments import ATTACHMENT_GROUP_KEY, parse_attachment_group


def _content(marker: Any) -> dict[str, object]:
    return {"msgtype": "m.image", "body": "cat.png", ATTACHMENT_GROUP_KEY: marker}


def test_valid_marker_returns_tuple() -> None:
    assert parse_attachment_group(_content({"id": "grp", "index": 1, "total": 3})) == (
        "grp",
        1,
        3,
    )


def test_group_of_one_is_valid() -> None:
    assert parse_attachment_group(_content({"id": "grp", "index": 0, "total": 1})) == (
        "grp",
        0,
        1,
    )


def test_missing_key_returns_none() -> None:
    assert parse_attachment_group({"msgtype": "m.image", "body": "cat.png"}) is None


@pytest.mark.parametrize("marker", ["not-a-dict", 7, None, [], ["id", 0, 1]])
def test_non_dict_marker_returns_none(marker: Any) -> None:
    assert parse_attachment_group(_content(marker)) is None


@pytest.mark.parametrize(
    "marker",
    [
        {"index": 0, "total": 2},  # missing id
        {"id": "", "index": 0, "total": 2},  # blank id
        {"id": 7, "index": 0, "total": 2},  # non-str id
        {"id": "grp", "total": 2},  # missing index
        {"id": "grp", "index": 0},  # missing total
        {"id": "grp", "index": "0", "total": 2},  # non-int index
        {"id": "grp", "index": 0, "total": "2"},  # non-int total
        {"id": "grp", "index": 0.0, "total": 2},  # float index
        {"id": "grp", "index": 0, "total": 0},  # total < 1
        {"id": "grp", "index": 0, "total": -1},  # negative total
        {"id": "grp", "index": -1, "total": 2},  # index < 0
        {"id": "grp", "index": 2, "total": 2},  # index == total
        {"id": "grp", "index": 5, "total": 2},  # index > total
    ],
)
def test_malformed_marker_degrades_to_ungrouped(marker: dict[str, Any]) -> None:
    # A bad marker must never raise: it degrades to an ungrouped attachment so
    # one odd event can't stall a receiver's buffer waiting for parts that
    # will never arrive.
    assert parse_attachment_group(_content(marker)) is None
