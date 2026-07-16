"""drop orchestrated from rooms

Revision ID: d31a4f0e9c01
Revises: aeb24dbc593c
Create Date: 2026-05-21 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d31a4f0e9c01"
down_revision: str | None = "aeb24dbc593c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("rooms", "orchestrated")


def downgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column("orchestrated", sa.Boolean(), server_default="false", nullable=False),
    )
