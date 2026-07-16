from __future__ import annotations

import pytest

from switch_core.bridges.resource.registry import (
    REFERENCE_TYPES,
    list_known_types,
    serialize_used_types,
    validate_reference_type,
    validate_reference_value,
)


def test_jira_type_is_registered():
    assert "jira" in REFERENCE_TYPES
    assert "jira" in list_known_types()
    spec = REFERENCE_TYPES["jira"]
    assert spec.type == "jira"
    assert spec.display_name == "Jira"
    # Instructions should point agents at the Atlassian connector.
    assert "Atlassian" in spec.instructions


def test_jira_public_dict_carries_value_schema():
    public = REFERENCE_TYPES["jira"].to_public_dict()
    assert public["type"] == "jira"
    assert public["display_name"] == "Jira"
    assert public["instructions"]
    # Mirrors confluence/github: a flat urls list with min_length=1.
    props = public["value_schema"]["properties"]
    assert "urls" in props


def test_jira_value_validates_url_list():
    normalised = validate_reference_value(
        "jira",
        {"urls": ["https://your-org.atlassian.net/browse/PROJ-123"]},
    )
    assert normalised == {"urls": ["https://your-org.atlassian.net/browse/PROJ-123"]}


def test_jira_value_strips_unknown_fields():
    normalised = validate_reference_value(
        "jira",
        {"urls": ["https://x.atlassian.net/browse/AB-1"], "bogus": "drop me"},
    )
    assert normalised == {"urls": ["https://x.atlassian.net/browse/AB-1"]}


def test_jira_empty_url_list_is_rejected():
    with pytest.raises(ValueError):
        validate_reference_value("jira", {"urls": []})


def test_unknown_type_is_rejected():
    with pytest.raises(ValueError):
        validate_reference_type("not_a_real_type")


def test_serialize_used_types_includes_jira():
    used = serialize_used_types({"jira"})
    assert used["jira"]["display_name"] == "Jira"
    assert "instructions" in used["jira"]
