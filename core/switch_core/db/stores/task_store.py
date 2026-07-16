from __future__ import annotations

from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from switch_core.db.models import Task


class TaskStore:
    async def create(self, session: AsyncSession, task: Task) -> Task:
        session.add(task)
        await session.flush()
        return task

    async def get(self, session: AsyncSession, task_id: str) -> Task | None:
        return await session.get(Task, task_id)

    async def get_by_agent(
        self,
        session: AsyncSession,
        agent_id: str,
        room_id: str | None = None,
        status: str | None = None,
    ) -> list[Task]:
        query = select(Task).where(
            or_(
                Task.requester_agent_id == agent_id,
                Task.performer_agent_id == agent_id,
            )
        )
        if room_id:
            query = query.where(Task.room_id == room_id)
        if status:
            query = query.where(Task.status == status)
        result = await session.execute(query)
        return list(result.scalars().all())

    async def get_by_room(
        self,
        session: AsyncSession,
        room_id: str,
        requester_id: str | None = None,
        performer_id: str | None = None,
        status: str | None = None,
    ) -> list[Task]:
        query = select(Task).where(Task.room_id == room_id)
        if requester_id:
            query = query.where(Task.requester_agent_id == requester_id)
        if performer_id:
            query = query.where(Task.performer_agent_id == performer_id)
        if status:
            query = query.where(Task.status == status)
        result = await session.execute(query)
        return list(result.scalars().all())

    async def accept(self, session: AsyncSession, task_id: str) -> Task:
        task = await session.get(Task, task_id)
        if task is None:
            raise ValueError(f"Task not found: {task_id}")
        task.status = "ongoing"
        task.accepted_at = datetime.now()  # type: ignore
        await session.flush()
        return task

    async def finalise(self, session: AsyncSession, task_id: str, outcome: str) -> Task:
        task = await session.get(Task, task_id)
        if task is None:
            raise ValueError(f"Task not found: {task_id}")
        task.status = "finalised"
        task.outcome = outcome
        task.finalised_at = datetime.now()  # type: ignore
        await session.flush()
        return task

    async def cancel(self, session: AsyncSession, task_id: str, reason: str) -> Task:
        task = await session.get(Task, task_id)
        if task is None:
            raise ValueError(f"Task not found: {task_id}")
        task.status = "cancelled"
        task.outcome = reason
        await session.flush()
        return task

    async def append_update(
        self, session: AsyncSession, task_id: str, update: str
    ) -> Task:
        task = await session.get(Task, task_id)
        if task is None:
            raise ValueError(f"Task not found: {task_id}")
        if task.updates is None:
            task.updates = []
        task.updates.append(update)
        await session.flush()
        return task

    async def update(
        self, session: AsyncSession, task_id: str, **kwargs: object
    ) -> Task:
        task = await session.get(Task, task_id)
        if task is None:
            raise ValueError(f"Task not found: {task_id}")
        for key, value in kwargs.items():
            setattr(task, key, value)
        await session.flush()
        return task
