"""팩토리 엔진 shim (factory_kit.py가 만듦). 엔진 버전: factory/kit.lock"""

import os
import sys
from pathlib import Path

# 심어 둔 바이트코드 캐시를 읽지도 쓰지도 않는다 (엔진 해시 대조를 우회하지 못하게)
sys.dont_write_bytecode = True
sys.pycache_prefix = str(Path.home() / ".factory" / "no-pycache" / os.urandom(8).hex())
sys.path.insert(0, str(Path(__file__).resolve().parents[0]))
import factory_engine  # noqa: E402

factory_engine.run("scripts/monitor.py")
