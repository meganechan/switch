"""link external users to switch users (CHOO-2137)

Revision ID: a1b2c3d4e5f6
Revises: b3f36489c258
Create Date: 2026-08-14 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "b3f36489c258"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "external_user_claims",
        sa.Column("external_user_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["external_user_id"], ["external_users.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("external_user_id", "user_id"),
    )
    op.create_index(
        "ix_external_user_claims_user_id",
        "external_user_claims",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_external_user_claims_user_id", table_name="external_user_claims")
    op.drop_table("external_user_claims")
