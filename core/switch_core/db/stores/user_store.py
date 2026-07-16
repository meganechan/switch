from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from switch_core.db.models import User


class UserStore:
    async def create(self, session: AsyncSession, user: User) -> None:
        session.add(user)
        await session.flush()

    async def get(self, session: AsyncSession, user_id: str) -> User | None:
        return await session.get(User, user_id)

    async def get_by_email(self, session: AsyncSession, email: str) -> User | None:
        result = await session.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def get_or_create_oidc_user(
        self, session: AsyncSession, *, email: str, name: str, sub: str
    ) -> User:
        """Resolve an OIDC identity to a gateway user, provisioning on first
        login (JIT).

        Matched on email: an existing user (password- or OIDC-provisioned)
        keeps its current role. A brand-new user is created as a plain `user`
        with no password hash; the IdP subject is stored in metadata so the
        link can be hardened later (email is mutable in some directories).
        """
        user = await self.get_by_email(session, email)
        if user is not None:
            return user
        user = User(
            name=name,
            email=email,
            role="user",
            password_hash=None,
            metadata_={"oidc_sub": sub},
        )
        await self.create(session, user)
        return user

    async def get_all(self, session: AsyncSession) -> list[User]:
        result = await session.execute(select(User))
        return list(result.scalars().all())
