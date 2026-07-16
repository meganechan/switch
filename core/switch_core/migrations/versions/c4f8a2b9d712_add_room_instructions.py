"""add room instructions

Revision ID: c4f8a2b9d712
Revises: 93bb75c91fa4
Create Date: 2026-05-20 16:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4f8a2b9d712"
down_revision: str | None = "93bb75c91fa4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("rooms", sa.Column("instructions", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("rooms", "instructions")
