from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from switch_core.db.models import Room, RoomGroup


class RoomGroupStore:
    """Storage for room groups (`room_groups`), a named tree of organizational
    groups that rooms can belong to.

    Groups nest via `parent_group_id` (a self-reference). The store enforces the
    tree invariant — no group may be its own ancestor — and implements
    promote-on-delete: deleting a group reparents its children to the deleted
    group's parent (member rooms become standalone via the `ON DELETE SET NULL`
    foreign key on `rooms.group_id`).
    """

    async def create(
        self,
        session: AsyncSession,
        *,
        name: str,
        description: str | None,
        color: str | None,
        parent_group_id: str | None,
    ) -> RoomGroup:
        if parent_group_id is not None:
            parent = await session.get(RoomGroup, parent_group_id)
            if parent is None:
                raise ValueError(f"Parent group not found: {parent_group_id}")
        group = RoomGroup(
            name=name,
            description=description,
            color=color,
            parent_group_id=parent_group_id,
        )
        session.add(group)
        await session.flush()
        return group

    async def get(self, session: AsyncSession, group_id: str) -> RoomGroup | None:
        return await session.get(RoomGroup, group_id)

    async def get_all(self, session: AsyncSession) -> list[RoomGroup]:
        result = await session.execute(select(RoomGroup).order_by(RoomGroup.created_at))
        return list(result.scalars().all())

    async def update_fields(
        self,
        session: AsyncSession,
        group_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        color: str | None = None,
        parent_group_id: str | None = None,
        reparent: bool = False,
    ) -> RoomGroup:
        """Update a group's fields.

        `parent_group_id` is only applied when `reparent=True`, so that callers
        can distinguish "make this group top-level" (`parent_group_id=None,
        reparent=True`) from "leave the parent unchanged" (`reparent=False`).
        Reparenting validates that the new parent does not create a cycle.
        """
        group = await session.get(RoomGroup, group_id)
        if group is None:
            raise ValueError(f"Room group not found: {group_id}")
        if name is not None:
            group.name = name
        if description is not None:
            group.description = description
        if color is not None:
            group.color = color
        if reparent:
            await self._validate_reparent(session, group_id, parent_group_id)
            group.parent_group_id = parent_group_id
        await session.flush()
        return group

    async def delete(self, session: AsyncSession, group_id: str) -> bool:
        """Delete a group, promoting its children to the group's own parent.

        Member rooms become standalone automatically (`rooms.group_id` is
        `ON DELETE SET NULL`). Returns False if the group does not exist.
        """
        group = await session.get(RoomGroup, group_id)
        if group is None:
            return False
        # Promote direct children to this group's parent before deleting, so the
        # FK's SET NULL behaviour (which would orphan them to top-level) is
        # superseded by the parent we choose here.
        await session.execute(
            update(RoomGroup)
            .where(RoomGroup.parent_group_id == group_id)
            .values(parent_group_id=group.parent_group_id)
        )
        await session.delete(group)
        await session.flush()
        return True

    async def _validate_reparent(
        self, session: AsyncSession, group_id: str, parent_group_id: str | None
    ) -> None:
        if parent_group_id is None:
            return
        if parent_group_id == group_id:
            raise ValueError("A group cannot be its own parent")
        parent = await session.get(RoomGroup, parent_group_id)
        if parent is None:
            raise ValueError(f"Parent group not found: {parent_group_id}")
        # Walk up from the proposed parent; if we reach `group_id`, the new
        # parent is a descendant of the group, which would create a cycle.
        cursor: str | None = parent_group_id
        seen: set[str] = set()
        while cursor is not None:
            if cursor == group_id:
                raise ValueError(
                    "Cannot reparent a group under one of its own descendants"
                )
            if cursor in seen:
                break
            seen.add(cursor)
            ancestor = await session.get(RoomGroup, cursor)
            cursor = ancestor.parent_group_id if ancestor else None

    async def get_room_counts(self, session: AsyncSession) -> dict[str, int]:
        """Return a mapping of group_id → number of rooms directly in that group."""
        result = await session.execute(
            select(Room.group_id, func.count(Room.id))
            .where(Room.group_id.is_not(None))
            .group_by(Room.group_id)
        )
        return {gid: count for gid, count in result.all() if gid is not None}
