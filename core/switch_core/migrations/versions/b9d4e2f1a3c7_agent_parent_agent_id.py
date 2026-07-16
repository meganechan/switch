"""add agents.parent_agent_id for Claude Code subagents

Revision ID: b9d4e2f1a3c7
Revises: a7f3c9e1d2b4
Create Date: 2026-06-05 14:50:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b9d4e2f1a3c7"
down_revision: str | None = "a7f3c9e1d2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column("parent_agent_id", sa.Text(), nullable=True),
    )
    op.create_foreign_key(
        "fk_agents_parent_agent_id",
        "agents",
        "agents",
        ["parent_agent_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_agents_parent_agent_id", "agents", ["parent_agent_id"])


def downgrade() -> None:
    op.drop_index("ix_agents_parent_agent_id", table_name="agents")
    op.drop_constraint("fk_agents_parent_agent_id", "agents", type_="foreignkey")
    op.drop_column("agents", "parent_agent_id")
