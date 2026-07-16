"""room-scoped documents: nullable owner_id, add room_id + created_by_agent_id

Revision ID: f2a5b6c7d8e9
Revises: e1f4a5b6c7d8
Create Date: 2026-05-25 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f2a5b6c7d8e9"
down_revision: str | None = "e1f4a5b6c7d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("documents", "owner_id", existing_type=sa.Text(), nullable=True)
    op.add_column(
        "documents",
        sa.Column(
            "room_id",
            sa.Text(),
            sa.ForeignKey("rooms.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "documents",
        sa.Column(
            "created_by_agent_id",
            sa.Text(),
            sa.ForeignKey("agents.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "uq_documents_room_name",
        "documents",
        ["room_id", "name"],
        unique=True,
        postgresql_where=sa.text("room_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_documents_room_name", table_name="documents")
    op.drop_column("documents", "created_by_agent_id")
    op.drop_column("documents", "room_id")
    op.execute("UPDATE \"documents\" SET owner_id = '' WHERE owner_id IS NULL")
    op.alter_column("documents", "owner_id", existing_type=sa.Text(), nullable=False)
