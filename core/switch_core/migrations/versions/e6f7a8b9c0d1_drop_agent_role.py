"""drop agents.role

The global agent role (performer/moderator/orchestrator) has been removed:
agent reachability is governed by room-scoped roles (role_leases) and the
admin client now handles what the moderator agent used to.

Revision ID: e6f7a8b9c0d1
Revises: d3a1c2b4e5f6
Create Date: 2026-06-18 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e6f7a8b9c0d1"
down_revision: str | None = "d3a1c2b4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("agents", "role")


def downgrade() -> None:
    op.add_column(
        "agents",
        sa.Column("role", sa.Text(), server_default="performer", nullable=False),
    )
