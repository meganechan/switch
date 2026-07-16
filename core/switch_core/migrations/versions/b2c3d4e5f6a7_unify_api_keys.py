"""unify_api_keys

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-05-17 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a7"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Drop server_connectors first (FK to registration_keys)
    op.drop_table("server_connectors")

    # Rename registration_keys → api_keys and add type column
    op.rename_table("registration_keys", "api_keys")
    op.add_column(
        "api_keys",
        sa.Column("type", sa.Text(), nullable=False, server_default="registration"),
    )

    # Agent: drop api_key_hash, add api_key_id FK
    op.add_column("agents", sa.Column("api_key_id", sa.Text(), nullable=True))
    op.drop_column("agents", "api_key_hash")
    op.create_foreign_key(
        "fk_agents_api_key_id", "agents", "api_keys", ["api_key_id"], ["id"]
    )

    # Recreate server_connectors with api_key_id instead of registration_key_id
    op.create_table(
        "server_connectors",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("connection_config", sa.JSON(), nullable=True),
        sa.Column("api_key_id", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["api_key_id"], ["api_keys.id"]),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("server_connectors")
    op.drop_constraint("fk_agents_api_key_id", "agents", type_="foreignkey")
    op.drop_column("agents", "api_key_id")
    op.add_column(
        "agents",
        sa.Column("api_key_hash", sa.Text(), nullable=False, server_default=""),
    )
    op.drop_column("api_keys", "type")
    op.rename_table("api_keys", "registration_keys")
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
        sa.ForeignKeyConstraint(["registration_key_id"], ["registration_keys.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
