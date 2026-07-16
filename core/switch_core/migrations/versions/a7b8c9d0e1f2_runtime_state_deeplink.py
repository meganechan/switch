"""add deeplink_url to agent_runtime_states

Revision ID: a7b8c9d0e1f2
Revises: f1a2b3c4d5e6
Create Date: 2026-06-29 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a7b8c9d0e1f2"
down_revision: str | None = "f1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agent_runtime_states",
        sa.Column("deeplink_url", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_runtime_states", "deeplink_url")
