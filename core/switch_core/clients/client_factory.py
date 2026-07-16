from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from switch_core.clients.client_base import ClientBase, ClientConfig
from switch_core.config import SwitchConfig
from switch_core.db.models import Client
from switch_core.db.stores.client_store import ClientStore

logger = logging.getLogger(__name__)


class ClientFactory:
    def __init__(
        self,
        *,
        client_store: ClientStore,
        session_factory: async_sessionmaker[AsyncSession],
        config: SwitchConfig,
    ) -> None:
        self._client_store = client_store
        self._session_factory = session_factory
        self._config = config
        self._registry: dict[
            str, tuple[type[ClientBase[ClientConfig]], dict[str, object]]
        ] = {}

    def register(
        self,
        client_type: str,
        cls: type[ClientBase[ClientConfig]],
        **extra_kwargs: object,
    ) -> None:
        self._registry[client_type] = (cls, extra_kwargs)

    def create(self, record: Client) -> ClientBase[ClientConfig]:
        entry = self._registry.get(record.type)
        if entry is None:
            raise ValueError(f"Unknown client type: {record.type!r}")
        cls, extra_kwargs = entry
        config = cls.config_class.model_validate(record.config or {})
        return cls(
            client_id=record.id,
            matrix_user_id=record.matrix_user_id,
            display_name=record.display_name,
            password=record.password,
            server_url=self._config.matrix_server,
            session_factory=self._session_factory,
            client_store=self._client_store,
            config=config,
            device_id=record.device_id,
            access_token=record.access_token,
            next_batch_token=record.next_batch_token,
            **extra_kwargs,
        )
