"""unique (bridge_id, external_channel_id) on rooms; dedupe existing (CHOO-1660)

Backstop for the Slack-bridge duplicate-room race: a channel must map to at
most one Switch room. Before adding the constraint we non-destructively
detach any pre-existing duplicates — keeping the earliest-created room per
(bridge_id, external_channel_id) bridged and turning the rest into
internal-only rooms (bridge_id / channel_type / external_channel_id cleared).
Rooms are never deleted, so no messages or memberships are lost.

Revision ID: d5e6f7a8b9c0
Revises: e4f5a6b7c8d9
Create Date: 2026-07-24 00:00:00.000000

"""

import logging
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5e6f7a8b9c0"
down_revision: str | None = "e4f5a6b7c8d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")

_INDEX_NAME = "uq_rooms_bridge_external_channel"

# Later duplicates per (bridge_id, external_channel_id) — everything except the
# earliest-created room in each group. created_at then id give a deterministic
# order so the same room is chosen as canonical on every run.
_SELECT_DUPLICATES = sa.text(
    """
    SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY bridge_id, external_channel_id
                   ORDER BY created_at ASC, id ASC
               ) AS rn
        FROM rooms
        WHERE bridge_id IS NOT NULL AND external_channel_id IS NOT NULL
    ) ranked
    WHERE rn > 1
    """
)

_DETACH_DUPLICATES = sa.text(
    """
    UPDATE rooms
    SET bridge_id = NULL, channel_type = NULL, external_channel_id = NULL
    WHERE id = ANY(:ids)
    """
)


def upgrade() -> None:
    conn = op.get_bind()
    duplicate_ids = [row[0] for row in conn.execute(_SELECT_DUPLICATES)]
    if duplicate_ids:
        logger.warning(
            "Detaching %d duplicate bridged room(s) into internal-only rooms "
            "before adding the unique channel constraint: %s",
            len(duplicate_ids),
            ", ".join(duplicate_ids),
        )
        conn.execute(_DETACH_DUPLICATES, {"ids": duplicate_ids})

    op.create_index(
        _INDEX_NAME,
        "rooms",
        ["bridge_id", "external_channel_id"],
        unique=True,
        postgresql_where=sa.text("external_channel_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(_INDEX_NAME, table_name="rooms")
