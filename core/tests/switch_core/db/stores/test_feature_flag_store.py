from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from switch_core.db.stores.feature_flag_store import FeatureFlagStore
from switch_core.feature_flags import ECOSYSTEM_SHOW_OWNERS


class TestFeatureFlagStore:
    async def test_absent_flag_defaults_off(
        self, session_factory: async_sessionmaker[AsyncSession]
    ) -> None:
        store = FeatureFlagStore()
        async with session_factory() as session:
            assert await store.get(session, ECOSYSTEM_SHOW_OWNERS) is False

    async def test_set_then_get(
        self, session_factory: async_sessionmaker[AsyncSession]
    ) -> None:
        store = FeatureFlagStore()
        async with session_factory() as session:
            await store.set(session, ECOSYSTEM_SHOW_OWNERS, True)
            await session.commit()

            assert await store.get(session, ECOSYSTEM_SHOW_OWNERS) is True

    async def test_set_is_idempotent_upsert(
        self, session_factory: async_sessionmaker[AsyncSession]
    ) -> None:
        store = FeatureFlagStore()
        async with session_factory() as session:
            await store.set(session, ECOSYSTEM_SHOW_OWNERS, True)
            await store.set(session, ECOSYSTEM_SHOW_OWNERS, False)
            await session.commit()

            assert await store.get(session, ECOSYSTEM_SHOW_OWNERS) is False

    async def test_get_all_includes_known_defaults(
        self, session_factory: async_sessionmaker[AsyncSession]
    ) -> None:
        store = FeatureFlagStore()
        async with session_factory() as session:
            flags = await store.get_all(session)
            assert flags[ECOSYSTEM_SHOW_OWNERS] is False

            await store.set(session, ECOSYSTEM_SHOW_OWNERS, True)
            await session.commit()

            flags = await store.get_all(session)
            assert flags[ECOSYSTEM_SHOW_OWNERS] is True
