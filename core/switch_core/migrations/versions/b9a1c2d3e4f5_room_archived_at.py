"""room archived_at: nullable timestamp marking a room as archived

Revision ID: b9a1c2d3e4f5
Revises: b0a50a7c2705
Create Date: 2026-06-02 12:20:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b9a1c2d3e4f5"
down_revision: str | None = "b0a50a7c2705"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("rooms", "archived_at")
