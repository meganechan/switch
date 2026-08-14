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
    op.add_column(
        "external_users",
        sa.Column("user_id", sa.Text(), nullable=True),
    )
    op.create_foreign_key(
        "fk_external_users_user_id",
        "external_users",
        "users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_external_users_user_id",
        "external_users",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_external_users_user_id", table_name="external_users")
    op.drop_constraint(
        "fk_external_users_user_id", "external_users", type_="foreignkey"
    )
    op.drop_column("external_users", "user_id")
