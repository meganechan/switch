"""add agent_greetings_enabled to collaboration_bridges

Revision ID: c7e8f9a0b1d2
Revises: b9d4e2f1a3c7
Create Date: 2026-06-10 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c7e8f9a0b1d2"
down_revision: str | None = "b9d4e2f1a3c7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "collaboration_bridges",
        sa.Column(
            "agent_greetings_enabled",
            sa.Boolean(),
            server_default="true",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("collaboration_bridges", "agent_greetings_enabled")
