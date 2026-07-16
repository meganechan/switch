from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from switch_core.db.models import ClientRoom, ExternalUser


class ExternalUserStore:
    async def create(self, session: AsyncSession, user: ExternalUser) -> ExternalUser:
        session.add(user)
        await session.flush()
        return user

    async def get(self, session: AsyncSession, user_id: str) -> ExternalUser | None:
        return await session.get(ExternalUser, user_id)

    async def get_by_external_id(
        self, session: AsyncSession, bridge_id: str, external_user_id: str
    ) -> ExternalUser | None:
        result = await session.execute(
            select(ExternalUser).where(
                ExternalUser.bridge_id == bridge_id,
                ExternalUser.external_user_id == external_user_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_by_bridge(
        self, session: AsyncSession, bridge_id: str
    ) -> list[ExternalUser]:
        result = await session.execute(
            select(ExternalUser).where(ExternalUser.bridge_id == bridge_id)
        )
        return list(result.scalars().all())

    async def get_by_bridge_and_names(
        self, session: AsyncSession, bridge_id: str, usernames: list[str]
    ) -> list[ExternalUser]:
        if not usernames:
            return []
        result = await session.execute(
            select(ExternalUser).where(
                ExternalUser.bridge_id == bridge_id,
                ExternalUser.external_username.in_(usernames),
            )
        )
        return list(result.scalars().all())

    async def get_by_client_id(
        self, session: AsyncSession, client_id: str
    ) -> ExternalUser | None:
        result = await session.execute(
            select(ExternalUser).where(ExternalUser.client_id == client_id)
        )
        return result.scalar_one_or_none()

    async def get_by_room(
        self, session: AsyncSession, room_id: str
    ) -> list[ExternalUser]:
        result = await session.execute(
            select(ExternalUser)
            .join(ClientRoom, ClientRoom.client_id == ExternalUser.client_id)
            .where(ClientRoom.room_id == room_id)
        )
        return list(result.scalars().all())

    async def delete(self, session: AsyncSession, user_id: str) -> None:
        user = await session.get(ExternalUser, user_id)
        if user:
            await session.delete(user)
            await session.flush()

    async def delete_by_bridge(self, session: AsyncSession, bridge_id: str) -> None:
        await session.execute(
            delete(ExternalUser).where(ExternalUser.bridge_id == bridge_id)
        )
        await session.flush()
