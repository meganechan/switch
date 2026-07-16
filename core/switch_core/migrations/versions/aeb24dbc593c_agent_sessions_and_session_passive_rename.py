"""agent sessions table and session_polling -> session_passive rename

Revision ID: aeb24dbc593c
Revises: c4f8a2b9d712
Create Date: 2026-05-21 15:04:07.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "aeb24dbc593c"
down_revision: str | None = "c4f8a2b9d712"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_sessions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("agent_id", sa.Text(), nullable=False),
        sa.Column("room_id", sa.Text(), nullable=True),
        sa.Column("transport_session_id", sa.Text(), nullable=True),
        sa.Column("lifecycle", sa.Text(), nullable=False),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "agent_id",
            "room_id",
            "transport_session_id",
            name="uq_agent_sessions_agent_room_transport",
        ),
    )
    op.create_index(
        "ix_agent_sessions_agent_room",
        "agent_sessions",
        ["agent_id", "room_id"],
    )
    op.create_index(
        "ix_agent_sessions_transport_session_id",
        "agent_sessions",
        ["transport_session_id"],
    )

    op.execute(
        "UPDATE agents SET agent_type = 'session_passive' "
        "WHERE agent_type = 'session_polling'"
    )
    op.execute(
        "UPDATE agents SET integration_profile = "
        "jsonb_set(integration_profile, '{connection_model}', '\"session_passive\"') "
        "WHERE integration_profile->>'connection_model' = 'session_polling'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE agents SET integration_profile = "
        "jsonb_set(integration_profile, '{connection_model}', '\"session_polling\"') "
        "WHERE integration_profile->>'connection_model' = 'session_passive'"
    )
    op.execute(
        "UPDATE agents SET agent_type = 'session_polling' "
        "WHERE agent_type = 'session_passive'"
    )
    op.drop_index("ix_agent_sessions_transport_session_id", table_name="agent_sessions")
    op.drop_index("ix_agent_sessions_agent_room", table_name="agent_sessions")
    op.drop_table("agent_sessions")
