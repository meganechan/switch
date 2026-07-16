"""Registry of server-global feature flags.

A feature flag is a named on/off switch stored in the ``feature_flags`` table
and flipped through the agent bridge (``PUT /agents/feature-flags/{key}``).
Only keys listed here may be written or read — an unknown key is rejected so
the endpoint cannot be used to write arbitrary rows. An absent row means the
flag is OFF, so ``DEFAULTS`` is purely documentation of that baseline.
"""

from __future__ import annotations

# Gate the ecosystem graph's "Show owners" overlay. When OFF the graph never
# exposes owner data, so the frontend toggle has nothing to reveal.
ECOSYSTEM_SHOW_OWNERS = "ecosystem.show_owners"

# All flags the server recognises, mapped to their default (off) state.
KNOWN_FEATURE_FLAGS: dict[str, bool] = {
    ECOSYSTEM_SHOW_OWNERS: False,
}


def is_known_flag(key: str) -> bool:
    return key in KNOWN_FEATURE_FLAGS
