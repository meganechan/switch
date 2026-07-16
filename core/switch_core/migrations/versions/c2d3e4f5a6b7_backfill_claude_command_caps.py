"""backfill session-based command_capabilities on Claude Code profiles

Existing Claude Code agents were registered before command_capabilities
existed, so their stored integration_profile lacks the key and resolves to
all-"unsupported". Bring them in line with `ClaudeCodeKnownAgent.build_profile`
(all three commands session_dependent) so reset/compact/interrupt work without
re-registering each agent.

Revision ID: c2d3e4f5a6b7
Revises: e2f3a4b5c6d7
Create Date: 2026-07-04 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "c2d3e4f5a6b7"
down_revision: str | None = "e2f3a4b5c6d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CLAUDE_CAPS = (
    '{"reset": "session_dependent", '
    '"compact": "session_dependent", '
    '"interrupt": "session_dependent"}'
)


def upgrade() -> None:
    # Merge the key in with jsonb_set(..., create_if_missing=true). Idempotent:
    # rows that already carry command_capabilities are overwritten with the same
    # canonical value.
    op.execute(
        f"""
        UPDATE agents
        SET integration_profile = jsonb_set(
            integration_profile,
            '{{command_capabilities}}',
            '{_CLAUDE_CAPS}'::jsonb,
            true
        )
        WHERE metadata->>'known_agent_type' = 'claude-code'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE agents
        SET integration_profile = integration_profile - 'command_capabilities'
        WHERE metadata->>'known_agent_type' = 'claude-code'
        """
    )
