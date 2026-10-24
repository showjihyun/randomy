from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from randomy.main import create_app
from randomy.settings import Settings


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(db_path=tmp_path / "test.db", model="fake")


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client
