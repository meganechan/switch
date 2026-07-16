"""add control_capabilities to agent_runtime_states

Revision ID: e2f3a4b5c6d7
Revises: b1c2d3e4f5a6
Create Date: 2026-07-01 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e2f3a4b5c6d7"
down_revision: str | None = "b1c2d3e4f5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agent_runtime_states",
        sa.Column("control_capabilities", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_runtime_states", "control_capabilities")
