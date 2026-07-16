"""add per-room agent alias to room_agents

Revision ID: d4e5f6a7b8c9
Revises: c7e8f9a0b1d2
Create Date: 2026-06-15 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4e5f6a7b8c9"
down_revision: str | None = "c7e8f9a0b1d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "room_agents",
        sa.Column("alias", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("room_agents", "alias")
