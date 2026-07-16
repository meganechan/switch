"""add name column to references, documents, packages

Revision ID: d0e3f4a5b6c7
Revises: c9d2e3f4a5b6
Create Date: 2026-05-25 13:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d0e3f4a5b6c7"
down_revision: str | None = "c9d2e3f4a5b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("references", "documents", "packages"):
        op.add_column(
            table,
            sa.Column("name", sa.Text(), nullable=False, server_default="toreplace"),
        )
        op.alter_column(table, "name", server_default=None)


def downgrade() -> None:
    for table in ("packages", "documents", "references"):
        op.drop_column(table, "name")
