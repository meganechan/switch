"""authz acls: split visibility into read/write; add room owner + visibility

Revision ID: f3b8c1d2e4a5
Revises: d1e2f3a4b5c6
Create Date: 2026-06-01 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f3b8c1d2e4a5"
down_revision: str | None = "d1e2f3a4b5c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_RESOURCE_TABLES = ("references", "documents", "packages")


def upgrade() -> None:
    # Resources: split the single `visibility` column into read_visibility +
    # write_visibility. Preserve today's semantics — `public` meant "readable
    # by anyone" and never granted write — so read_visibility = old visibility
    # and write_visibility = 'private'.
    for table in _RESOURCE_TABLES:
        op.add_column(table, sa.Column("read_visibility", sa.Text(), nullable=True))
        op.add_column(table, sa.Column("write_visibility", sa.Text(), nullable=True))
        op.execute(f'UPDATE "{table}" SET read_visibility = visibility')
        op.execute(f"UPDATE \"{table}\" SET write_visibility = 'private'")
        op.alter_column(
            table, "read_visibility", existing_type=sa.Text(), nullable=False
        )
        op.alter_column(
            table, "write_visibility", existing_type=sa.Text(), nullable=False
        )
        op.drop_column(table, "visibility")

    # Rooms: add owner_id (backfilled from created_by) plus read/write
    # visibility. Backfill public/public so existing rooms keep today's
    # wide-open behaviour — privacy is opt-in.
    op.add_column(
        "rooms",
        sa.Column("owner_id", sa.Text(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.add_column(
        "rooms",
        sa.Column(
            "read_visibility", sa.Text(), nullable=False, server_default="public"
        ),
    )
    op.add_column(
        "rooms",
        sa.Column(
            "write_visibility", sa.Text(), nullable=False, server_default="public"
        ),
    )
    op.execute('UPDATE "rooms" SET owner_id = created_by')


def downgrade() -> None:
    op.drop_column("rooms", "write_visibility")
    op.drop_column("rooms", "read_visibility")
    op.drop_column("rooms", "owner_id")

    for table in _RESOURCE_TABLES:
        op.add_column(table, sa.Column("visibility", sa.Text(), nullable=True))
        # Collapse the two axes back into one (lossy: a distinct
        # write_visibility is discarded). Public wins if either axis is public.
        op.execute(
            f'UPDATE "{table}" SET visibility = CASE '
            f"WHEN read_visibility = 'public' OR write_visibility = 'public' "
            f"THEN 'public' ELSE 'private' END"
        )
        op.alter_column(table, "visibility", existing_type=sa.Text(), nullable=False)
        op.drop_column(table, "write_visibility")
        op.drop_column(table, "read_visibility")
