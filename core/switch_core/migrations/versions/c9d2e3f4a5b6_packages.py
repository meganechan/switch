"""packages

Revision ID: c9d2e3f4a5b6
Revises: b8d1e2f3a4c5
Create Date: 2026-05-25 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c9d2e3f4a5b6"
down_revision: str | None = "b8d1e2f3a4c5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "packages",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("owner_id", sa.Text(), nullable=False),
        sa.Column("visibility", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "room_packages",
        sa.Column("room_id", sa.Text(), nullable=False),
        sa.Column("package_id", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"]),
        sa.ForeignKeyConstraint(["package_id"], ["packages.id"]),
        sa.PrimaryKeyConstraint("room_id", "package_id"),
    )
    op.create_table(
        "package_references",
        sa.Column("package_id", sa.Text(), nullable=False),
        sa.Column("reference_id", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["package_id"], ["packages.id"]),
        sa.ForeignKeyConstraint(["reference_id"], ["references.id"]),
        sa.PrimaryKeyConstraint("package_id", "reference_id"),
    )
    op.create_table(
        "package_documents",
        sa.Column("package_id", sa.Text(), nullable=False),
        sa.Column("document_id", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["package_id"], ["packages.id"]),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"]),
        sa.PrimaryKeyConstraint("package_id", "document_id"),
    )


def downgrade() -> None:
    op.drop_table("package_documents")
    op.drop_table("package_references")
    op.drop_table("room_packages")
    op.drop_table("packages")
