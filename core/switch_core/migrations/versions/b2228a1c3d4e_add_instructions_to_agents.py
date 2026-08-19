"""add instructions to agents (CHOO-2228)

Revision ID: b2228a1c3d4e
Revises: a2171c0de1f4
Create Date: 2026-08-19 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2228a1c3d4e"
down_revision: str | None = "a2171c0de1f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing agents start with no instructions. The values they have today
    # live on each user's machine (Switch Console's provider config, or the
    # on-disk Claude Code subagent file) and never reached the server, so there
    # is nothing here to backfill from — Console lifts them up on first run.
    op.add_column(
        "agents",
        sa.Column("instructions", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("agents", "instructions")
