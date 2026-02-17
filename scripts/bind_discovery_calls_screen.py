#!/usr/bin/env python3
"""Bind existing discovery-call metrics to the new discovery-calls screen.

Keeps existing bindings on the pipeline screen untouched.
Safe to re-run — skips if bindings already exist.
"""

import sqlite3
import uuid
import os

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")

BINDINGS = [
    {
        "slug": "discovery-call-summary",
        "screen_id": "discovery-calls",
        "position": 0,
        "layout_hint": "wide",
        "grid_x": 0,
        "grid_y": 0,
        "grid_w": 8,
        "grid_h": 4,
    },
    {
        "slug": "trailing-discovery-calls",
        "screen_id": "discovery-calls",
        "position": 1,
        "layout_hint": "wide",
        "grid_x": 0,
        "grid_y": 4,
        "grid_w": 8,
        "grid_h": 7,
    },
]


def main():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    added = 0
    skipped = 0

    for b in BINDINGS:
        # Resolve metric_id from slug
        cursor.execute("SELECT id FROM metric_definitions WHERE slug = ?", (b["slug"],))
        row = cursor.fetchone()
        if not row:
            print(f"  MISS  {b['slug']} — metric not found, run seed_discovery_calls.py first")
            skipped += 1
            continue
        metric_id = row[0]

        # Check if already bound to this screen
        cursor.execute(
            "SELECT COUNT(*) FROM screen_metrics WHERE screen_id = ? AND metric_id = ?",
            (b["screen_id"], metric_id),
        )
        if cursor.fetchone()[0] > 0:
            print(f"  SKIP  {b['slug']} already bound to {b['screen_id']}")
            skipped += 1
            continue

        binding_id = str(uuid.uuid4())
        cursor.execute(
            """INSERT INTO screen_metrics
               (id, screen_id, metric_id, position, layout_hint, grid_x, grid_y, grid_w, grid_h)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                binding_id,
                b["screen_id"],
                metric_id,
                b["position"],
                b["layout_hint"],
                b["grid_x"],
                b["grid_y"],
                b["grid_w"],
                b["grid_h"],
            ),
        )
        print(f"  BIND  {b['slug']} -> {b['screen_id']} ({b['grid_w']}x{b['grid_h']})")
        added += 1

    conn.commit()
    conn.close()
    print(f"\nDone: {added} bound, {skipped} skipped")


if __name__ == "__main__":
    main()
