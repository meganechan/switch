"""room_groups: named, optionally-nested organizational groups for rooms

Revision ID: f0e1d2c3b4a5
Revises: f3b8c1d2e4a5
Create Date: 2026-06-01 18:45:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f0e1d2c3b4a5"
down_revision: str | None = "f3b8c1d2e4a5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "room_groups",
        sa.Column("id", sa.Text(), primary_key=True, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("color", sa.Text(), nullable=True),
        sa.Column(
            "parent_group_id",
            sa.Text(),
            sa.ForeignKey("room_groups.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("parent_group_id <> id", name="room_groups_no_self_parent"),
    )
    op.add_column(
        "rooms",
        sa.Column(
            "group_id",
            sa.Text(),
            sa.ForeignKey("room_groups.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("rooms", "group_id")
    op.drop_table("room_groups")
