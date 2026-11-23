import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

test_database_dir = TemporaryDirectory(prefix="kpc-api-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{Path(test_database_dir.name, 'test.db').as_posix()}"

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
