"""Backend performance measurements for PERFORMANCE_REPORT.md.

    python scripts/perf_api.py [--base http://localhost:8000] [--runs 30]

Measures API response times (p50/p95) for the main read endpoints, offline
synchronisation throughput, and the PostgreSQL plans of the hottest queries.
Writes backend/perf-results/api.json. Uses only the synthetic demo accounts.
"""
from __future__ import annotations

import argparse
import json
import statistics
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from sqlalchemy import create_engine, text

PASSWORD = "demo123"  # synthetic demo credential


def stats(samples: list[float]) -> dict:
    ordered = sorted(samples)
    pick = lambda q: ordered[min(len(ordered) - 1, int(q * len(ordered)))]  # noqa: E731
    return {"n": len(ordered), "p50": round(pick(0.5), 1), "p95": round(pick(0.95), 1), "mean": round(statistics.fmean(ordered), 1)}


def login(client: httpx.Client, username: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": f"demo.{username}@kpc.co.ke", "password": PASSWORD})
    response.raise_for_status()
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def time_get(client: httpx.Client, headers: dict, path: str, runs: int) -> dict:
    client.get(path, headers=headers).raise_for_status()  # warm-up
    samples = []
    for _ in range(runs):
        start = time.perf_counter()
        response = client.get(path, headers=headers)
        samples.append((time.perf_counter() - start) * 1000)
        response.raise_for_status()
    return {**stats(samples), "bytes": len(response.content)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:8000")
    parser.add_argument("--runs", type=int, default=30)
    parser.add_argument("--database-url", default="postgresql+psycopg://kpc:kpc-demo@localhost:5433/kpc")
    args = parser.parse_args()

    results: dict = {"measured_at": datetime.now(timezone.utc).isoformat(), "runs_per_endpoint": args.runs}
    with httpx.Client(base_url=args.base, timeout=30) as client:
        manager = login(client, "maintenance-manager")
        automation = login(client, "automation")
        operations = login(client, "operations")
        faults = client.get("/api/v1/faults", headers=automation).json()
        fault_id = faults[0]["id"]
        equipment_id = faults[0]["equipment_id"]
        endpoints = {
            "GET /faults (Systems Automation)": (automation, "/api/v1/faults"),
            "GET /faults/{id}/context": (automation, f"/api/v1/faults/{fault_id}/context"),
            "GET /faults/{id}/timeline": (automation, f"/api/v1/faults/{fault_id}/timeline"),
            "GET /equipment": (automation, "/api/v1/equipment"),
            "GET /intelligence/equipment/{id}": (automation, f"/api/v1/intelligence/equipment/{equipment_id}"),
            "GET /knowledge": (automation, "/api/v1/knowledge"),
            "GET /analytics/overview": (manager, "/api/v1/analytics/overview"),
        }
        results["api_ms"] = {name: time_get(client, headers, path, args.runs) for name, (headers, path) in endpoints.items()}
        results["dataset"] = {"faults_visible_to_systems_automation": len(faults)}

        # Offline synchronisation throughput: a device uploads queued operator updates.
        target = next(item for item in client.get("/api/v1/faults?history_scope=reported_by_me", headers=operations).json()
                      if item["status"] != "CLOSED")
        throughput = {}
        for size in (1, 50, 200):
            events = [{
                "event_id": str(uuid.uuid4()), "fault_id": target["id"], "event_type": "OPERATOR_UPDATE",
                "device_id": "DEVICE-PERF", "client_timestamp": datetime.now(timezone.utc).isoformat(),
                "sequence_number": index, "payload": {"note": f"Synthetic perf update {index}"},
            } for index in range(size)]
            start = time.perf_counter()
            response = client.post("/api/v1/sync/events", headers=operations, json=events)
            elapsed = time.perf_counter() - start
            response.raise_for_status()
            applied = response.json()["counts"]["APPLIED"]
            throughput[f"batch_{size}"] = {
                "ms": round(elapsed * 1000, 1), "applied": applied, "events_per_second": round(size / elapsed, 1),
            }
            # Resending is idempotent; measure duplicate handling too.
            start = time.perf_counter()
            duplicate = client.post("/api/v1/sync/events", headers=operations, json=events).json()
            throughput[f"batch_{size}"]["resend_ms"] = round((time.perf_counter() - start) * 1000, 1)
            throughput[f"batch_{size}"]["resend_duplicates"] = duplicate["counts"]["DUPLICATE"]
        results["sync_throughput"] = throughput

    # Query plans for the hottest lookups (index use on PostgreSQL).
    engine = create_engine(args.database_url)
    plans = {}
    with engine.connect() as connection:
        for name, sql, params in [
            ("fault timeline by fault_id", "SELECT * FROM fault_events WHERE fault_id = :id ORDER BY created_at", {"id": fault_id}),
            ("repeat lookup by equipment (90 days)",
             "SELECT id FROM faults WHERE equipment_id = :eq AND created_at >= now() - interval '90 days' ORDER BY created_at DESC LIMIT 10",
             {"eq": equipment_id}),
            ("open faults by status", "SELECT count(*) FROM faults WHERE status NOT IN ('RESTORED','CLOSED')", {}),
            ("sync idempotency check", "SELECT 1 FROM sync_events WHERE event_id = :id", {"id": "missing"}),
        ]:
            rows = connection.execute(text(f"EXPLAIN (ANALYZE, FORMAT TEXT) {sql}"), params).scalars().all()
            plans[name] = rows
        counts = {table: connection.execute(text(f"SELECT count(*) FROM {table}")).scalar() for table in
                  ("faults", "fault_events", "equipment", "sync_events", "diagnoses", "interventions")}
    results["query_plans"] = plans
    results["table_rows"] = counts

    out = Path(__file__).resolve().parents[1] / "perf-results"
    out.mkdir(exist_ok=True)
    (out / "api.json").write_text(json.dumps(results, indent=2))
    print(json.dumps({key: value for key, value in results.items() if key != "query_plans"}, indent=2))


if __name__ == "__main__":
    main()
