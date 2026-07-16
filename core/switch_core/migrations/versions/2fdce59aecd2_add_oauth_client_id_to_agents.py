"""add oauth_client_id to agents

Revision ID: 2fdce59aecd2
Revises: b2c3d4e5f6a7
Create Date: 2026-05-19 11:49:11.175905

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2fdce59aecd2"
down_revision: str | None = "b2c3d4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agents", sa.Column("oauth_client_id", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("agents", "oauth_client_id")
