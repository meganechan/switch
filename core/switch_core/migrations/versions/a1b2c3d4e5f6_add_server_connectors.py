"""add_server_connectors

Revision ID: a1b2c3d4e5f6
Revises: 41a8c66bf04a
Create Date: 2026-05-17 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "41a8c66bf04a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registration_keys",
        sa.Column("encrypted_key", sa.Text(), nullable=False),
    )

    op.create_table(
        "server_connectors",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("connection_config", sa.JSON(), nullable=True),
        sa.Column("registration_key_id", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["registration_key_id"],
            ["registration_keys.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("server_connectors")
    op.drop_column("registration_keys", "encrypted_key")
