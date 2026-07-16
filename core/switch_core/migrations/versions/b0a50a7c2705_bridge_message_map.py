"""thread support: bridge message map

Durable correlation between a Matrix event and its external (bridge) post,
used for thread bridging and edit/delete sync (previously an in-memory dict).

Revision ID: b0a50a7c2705
Revises: f0e1d2c3b4a5
Create Date: 2026-06-02 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b0a50a7c2705"
down_revision: str | None = "f0e1d2c3b4a5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "bridge_message_map",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column(
            "bridge_id",
            sa.Text(),
            sa.ForeignKey("collaboration_bridges.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("external_channel_id", sa.Text(), nullable=False),
        sa.Column("matrix_event_id", sa.Text(), nullable=False),
        sa.Column("external_post_id", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "bridge_id", "matrix_event_id", name="uq_bridge_message_map_event"
        ),
        sa.UniqueConstraint(
            "bridge_id", "external_post_id", name="uq_bridge_message_map_post"
        ),
    )


def downgrade() -> None:
    op.drop_table("bridge_message_map")
