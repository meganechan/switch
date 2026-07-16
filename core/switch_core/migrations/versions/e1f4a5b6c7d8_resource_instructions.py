"""split description into description + instructions on references, documents, packages

Revision ID: e1f4a5b6c7d8
Revises: d0e3f4a5b6c7
Create Date: 2026-05-25 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e1f4a5b6c7d8"
down_revision: str | None = "d0e3f4a5b6c7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("references", "documents", "packages"):
        op.add_column(
            table,
            sa.Column("instructions", sa.Text(), nullable=False, server_default=""),
        )
        # Seed existing rows: copy the prior description into instructions so
        # that agent-facing behaviour is preserved until the owner edits it.
        # `references` is a reserved keyword in Postgres — always double-quote.
        op.execute(f'UPDATE "{table}" SET instructions = description')
        op.alter_column(table, "instructions", server_default=None)


def downgrade() -> None:
    for table in ("packages", "documents", "references"):
        op.drop_column(table, "instructions")
