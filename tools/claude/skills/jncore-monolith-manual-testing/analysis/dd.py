import json
import subprocess
import time


def pup(args):
    proc = None
    for _ in range(3):
        proc = subprocess.run(
            ["pup", *args, "--read-only", "--no-agent", "--output", "json"],
            capture_output=True, text=True, encoding="utf-8", timeout=300,
        )
        start = proc.stdout.find("{")
        if proc.returncode == 0 and start >= 0:
            return json.loads(proc.stdout[start:])
        time.sleep(3)
    raise RuntimeError(f"pup failed: {proc.stderr[:300]} {' '.join(args)[:200]}")


def search(query, frm, to, limit=50):
    args = ["logs", "search", "--query", query, "--from", frm, "--to", to, "--limit", str(limit)]
    return pup(args).get("data", [])


def aggregate(query, frm, to, group_by=None, expect_rows=False):
    args = ["logs", "aggregate", "--query", query, "--from", frm, "--to", to]
    if group_by:
        args += ["--group-by", group_by]
    for _ in range(3):
        d = pup(args)
        if d.get("meta", {}).get("status") != "done":
            raise RuntimeError(f"aggregate not done: {query}")
        buckets = d.get("data", {}).get("buckets", [])
        rows = [(b.get("by", {}), b.get("computes", {}).get("c0")) for b in buckets]
        if rows or not expect_rows:
            return rows
        time.sleep(5)
    raise RuntimeError(f"aggregate returned no rows three times, refusing to read it as zero: {query}")
