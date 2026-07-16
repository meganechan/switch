"""rekey agent_sessions on (agent_id, room_id) with COALESCE for NULL rooms

Revision ID: f7b0c1d2e3a4
Revises: e5f6a7b8c9d0
Create Date: 2026-05-22 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "f7b0c1d2e3a4"
down_revision: str | None = "e5f6a7b8c9d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        "uq_agent_sessions_agent_room_transport",
        "agent_sessions",
        type_="unique",
    )
    # Pre-existing duplicates can exist for (agent_id, NULL room_id) because
    # the old unique constraint treated NULLs as distinct. Keep only the most
    # recent row per (agent_id, COALESCE(room_id, '')) so the new unique index
    # can be created.
    op.execute(
        """
        DELETE FROM agent_sessions a
        USING agent_sessions b
        WHERE a.agent_id = b.agent_id
          AND COALESCE(a.room_id, '') = COALESCE(b.room_id, '')
          AND (
            a.last_seen_at < b.last_seen_at
            OR (a.last_seen_at = b.last_seen_at AND a.id < b.id)
          )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_agent_sessions_agent_room "
        "ON agent_sessions (agent_id, COALESCE(room_id, ''))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX uq_agent_sessions_agent_room")
    op.create_unique_constraint(
        "uq_agent_sessions_agent_room_transport",
        "agent_sessions",
        ["agent_id", "room_id", "transport_session_id"],
    )
