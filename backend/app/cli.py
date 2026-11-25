"""Database management commands for the demonstration environment.

    python -m app.cli migrate   # apply Alembic migrations
    python -m app.cli seed      # load illustrative data into an empty database
    python -m app.cli reset     # drop everything, migrate and reseed
    python -m app.cli send-reports  # email any due weekly/monthly/financial-year report
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


def send_reports() -> None:
    """Email due weekly/monthly/financial-year reports (each person once); for cron or Task Scheduler."""
    from app.db import SessionLocal
    from app.services.reports import send_due

    with SessionLocal() as db:
        print(f"reports sent: {send_due(db)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=("migrate", "seed", "reset", "init", "send-reports"))
    args = parser.parse_args()
    if args.command == "init":
        migrate()
        seed()
    else:
        {"migrate": migrate, "seed": seed, "reset": reset, "send-reports": send_reports}[args.command]()
    print(f"{args.command}: done")


if __name__ == "__main__":
    main()
