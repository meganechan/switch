"""rename channel types: group->channel_private, channel->channel_public

Revision ID: e5f6a7b8c9d0
Revises: d31a4f0e9c01
Create Date: 2026-05-21 14:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5f6a7b8c9d0"
down_revision: str | None = "d31a4f0e9c01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE rooms SET channel_type = 'channel_private' WHERE channel_type = 'group'"
    )
    op.execute(
        "UPDATE rooms SET channel_type = 'channel_public' WHERE channel_type = 'channel'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE rooms SET channel_type = 'group' WHERE channel_type = 'channel_private'"
    )
    op.execute(
        "UPDATE rooms SET channel_type = 'channel' WHERE channel_type = 'channel_public'"
    )
