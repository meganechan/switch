"""add receives_join_events to room_agents

Revision ID: d3a1c2b4e5f6
Revises: d4e5f6a7b8c9
Create Date: 2026-06-16 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d3a1c2b4e5f6"
down_revision: str | None = "d4e5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "room_agents",
        sa.Column(
            "receives_join_events",
            sa.Boolean(),
            server_default="false",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("room_agents", "receives_join_events")
