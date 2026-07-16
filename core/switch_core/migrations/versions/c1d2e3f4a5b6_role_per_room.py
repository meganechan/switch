"""role per room: room_roles + role_leases

Revision ID: c1d2e3f4a5b6
Revises: b9a1c2d3e4f5
Create Date: 2026-06-03 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "c1d2e3f4a5b6"
down_revision: str | None = "b9a1c2d3e4f5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "room_roles",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("room_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("exclusive", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("eligibility", JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("room_id", "name", name="uq_room_roles_room_name"),
    )
    op.create_table(
        "role_leases",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("role_id", sa.Text(), nullable=False),
        sa.Column("room_id", sa.Text(), nullable=False),
        sa.Column("agent_id", sa.Text(), nullable=False),
        sa.Column("transport_session_id", sa.Text(), nullable=True),
        sa.Column(
            "acquired_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["role_id"], ["room_roles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("agent_id", name="uq_role_leases_agent"),
    )
    op.create_index("ix_role_leases_role_id", "role_leases", ["role_id"])


def downgrade() -> None:
    op.drop_index("ix_role_leases_role_id", table_name="role_leases")
    op.drop_table("role_leases")
    op.drop_table("room_roles")
