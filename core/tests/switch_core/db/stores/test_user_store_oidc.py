from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from switch_core.db.models import User
from switch_core.db.stores.user_store import UserStore


class TestGetOrCreateOidcUser:
    async def test_creates_new_user_as_plain_user(
        self, session_factory: async_sessionmaker[AsyncSession]
    ) -> None:
        store = UserStore()
        async with session_factory() as session:
            user = await store.get_or_create_oidc_user(
                session, email="new@example.com", name="New", sub="okta|9"
            )
            await session.commit()
            assert user.role == "user"
            assert user.password_hash is None
            assert user.metadata_ == {"oidc_sub": "okta|9"}

    async def test_existing_user_is_returned_and_keeps_role(
        self, session_factory: async_sessionmaker[AsyncSession]
    ) -> None:
        store = UserStore()
        async with session_factory() as session:
            admin = User(
                name="Admin",
                email="admin@example.com",
                role="admin",
                password_hash="bcrypt-hash",
            )
            await store.create(session, admin)
            await session.commit()

            got = await store.get_or_create_oidc_user(
                session, email="admin@example.com", name="Different", sub="okta|1"
            )
            assert got.id == admin.id
            # Matching an existing account must NOT downgrade its role.
            assert got.role == "admin"
