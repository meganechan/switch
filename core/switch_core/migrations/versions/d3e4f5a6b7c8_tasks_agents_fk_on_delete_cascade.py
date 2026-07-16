"""tasks -> agents FKs ON DELETE CASCADE

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-07-14 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3e4f5a6b7c8"
down_revision: str | None = "c2d3e4f5a6b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("tasks_requester_agent_id_fkey", "tasks", type_="foreignkey")
    op.drop_constraint("tasks_performer_agent_id_fkey", "tasks", type_="foreignkey")
    op.create_foreign_key(
        "tasks_requester_agent_id_fkey",
        "tasks",
        "agents",
        ["requester_agent_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "tasks_performer_agent_id_fkey",
        "tasks",
        "agents",
        ["performer_agent_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("tasks_requester_agent_id_fkey", "tasks", type_="foreignkey")
    op.drop_constraint("tasks_performer_agent_id_fkey", "tasks", type_="foreignkey")
    op.create_foreign_key(
        "tasks_requester_agent_id_fkey",
        "tasks",
        "agents",
        ["requester_agent_id"],
        ["id"],
    )
    op.create_foreign_key(
        "tasks_performer_agent_id_fkey",
        "tasks",
        "agents",
        ["performer_agent_id"],
        ["id"],
    )
