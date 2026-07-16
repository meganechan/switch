"""backfill known_agent_options metadata on existing Claude Code agents

Revision ID: b3d4e5f6a701
Revises: f2a5b6c7d8e9
Create Date: 2026-05-26 12:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "b3d4e5f6a701"
down_revision: str | None = "f2a5b6c7d8e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Per-known-agent options are now part of register-known. Pre-existing
    # Claude Code agents were registered before the channel/passive split
    # existed; seed channels_enabled=true so their behaviour is preserved and
    # the gateway UI can edit the field. Their existing integration_profile
    # already reflects this (session_addressable) and is left untouched.
    op.execute(
        """
        UPDATE agents
        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                'known_agent_type', 'claude-code',
                'known_agent_options', jsonb_build_object('channels_enabled', true)
            )
        WHERE connector_type = 'Claude Code'
          AND (metadata IS NULL OR NOT (metadata ? 'known_agent_options'))
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE agents
        SET metadata = metadata - 'known_agent_options' - 'known_agent_type'
        WHERE connector_type = 'Claude Code'
        """
    )
