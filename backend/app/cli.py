"""Database management commands for the demonstration environment.

    python -m app.cli migrate   # apply Alembic migrations
    python -m app.cli seed      # load illustrative data into an empty database
    python -m app.cli reset     # drop everything, migrate and reseed
"""
from __future__ import annotations

import argparse
from pathlib import Path

from alembic import command
from alembic.config import Config

from app.core.config import BACKEND_ROOT


def alembic_config() -> Config:
    config = Config(str(Path(BACKEND_ROOT, "alembic.ini")))
    config.set_main_option("script_location", str(Path(BACKEND_ROOT, "migrations")))
    return config


def migrate() -> None:
    command.upgrade(alembic_config(), "head")


def seed() -> None:
    from app.seed import seed_database

    seed_database()


def reset() -> None:
    command.downgrade(alembic_config(), "base")
    migrate()
    seed()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=("migrate", "seed", "reset", "init"))
    args = parser.parse_args()
    if args.command == "init":
        migrate()
        seed()
    else:
        {"migrate": migrate, "seed": seed, "reset": reset}[args.command]()
    print(f"{args.command}: done")


if __name__ == "__main__":
    main()
