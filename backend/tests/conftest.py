"""Test database setup.

By default tests run against a throwaway SQLite file. Set KPC_TEST_DATABASE_URL
to a PostgreSQL URL to run the same suite against PostgreSQL; that database is
reset (downgraded to base, migrated and reseeded) at the start of the session.
"""
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

test_database_dir = TemporaryDirectory(prefix="kpc-api-tests-")
os.environ["DATABASE_URL"] = os.environ.get(
    "KPC_TEST_DATABASE_URL",
    f"sqlite:///{Path(test_database_dir.name, 'test.db').as_posix()}",
)

# Tests send reports explicitly; never from the background.
os.environ["REPORT_SCHEDULER"] = "false"
# Tests use the full illustrative dataset (a live demo starts from the small sample).
os.environ.setdefault("SEED_PROFILE", "full")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import cli  # noqa: E402  (must import after DATABASE_URL is set)

cli.reset()
