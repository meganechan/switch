"""Backfill known_agent_type / known_agent_options for legacy Claude Code agents.

Revision ID: d1e2f3a4b5c6
Revises: c4e5a6b7d8e9
Create Date: 2026-05-29 10:00:00.000000

Older Claude Code agents were registered before the gateway's
`register-known` endpoint started persisting `metadata.known_agent_type` and
`metadata.known_agent_options`. Without those keys the gateway can't tell
which spec to validate against, so the "edit options" path treats them as
non-editable.

This migration backfills both keys for any Claude Code agent that's
missing them. `channels_enabled` is inferred from the existing
`integration_profile.connection_model` so the rebuilt profile would match
what's already on the row. `repo_dir` and `notify_user` (added later) are
left at their schema defaults of NULL — the operator can fill them in via
the gateway edit dialog.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "d1e2f3a4b5c6"
down_revision: str | None = "c4e5a6b7d8e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # jsonb_set with create_missing=true adds keys without touching unrelated
    # ones. We update in two passes so each `jsonb_set` sees the previous
    # write. Only rows where the key is missing are touched.
    # Some pre-existing rows stored `metadata` as a JSON list (or NULL). Coerce
    # those to `{}` before adding the key — `jsonb_set` rejects string paths
    # against non-object values.
    op.execute(
        """
        UPDATE agents
        SET metadata = jsonb_set(
            CASE
                WHEN jsonb_typeof(metadata) = 'object' THEN metadata
                ELSE '{}'::jsonb
            END,
            '{known_agent_type}',
            '"claude-code"'::jsonb,
            true
        )
        WHERE connector_type = 'Claude Code'
          AND (
            metadata IS NULL
            OR jsonb_typeof(metadata) <> 'object'
            OR NOT (metadata ? 'known_agent_type')
          )
        """
    )

    op.execute(
        """
        UPDATE agents
        SET metadata = jsonb_set(
            metadata,
            '{known_agent_options}',
            jsonb_build_object(
                'channels_enabled',
                COALESCE(integration_profile->>'connection_model', 'session_addressable')
                  = 'session_addressable'
            ),
            true
        )
        WHERE connector_type = 'Claude Code'
          AND metadata IS NOT NULL
          AND jsonb_typeof(metadata) = 'object'
          AND metadata->>'known_agent_type' = 'claude-code'
          AND NOT (metadata ? 'known_agent_options')
        """
    )


def downgrade() -> None:
    # No-op: removing the keys we just added would break the gateway for
    # any agent that has since been edited. The forward migration is
    # idempotent and safe to re-run, so leaving the keys in place on
    # downgrade is the conservative choice.
    pass
