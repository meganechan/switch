"""room_links: directed labelled pointers between rooms

Revision ID: c4e5a6b7d8e9
Revises: b3d4e5f6a701
Create Date: 2026-05-27 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4e5a6b7d8e9"
down_revision: str | None = "b3d4e5f6a701"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "room_links",
        sa.Column(
            "source_room_id",
            sa.Text(),
            sa.ForeignKey("rooms.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "target_room_id",
            sa.Text(),
            sa.ForeignKey("rooms.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "source_room_id <> target_room_id", name="room_links_no_self"
        ),
    )


def downgrade() -> None:
    op.drop_table("room_links")
