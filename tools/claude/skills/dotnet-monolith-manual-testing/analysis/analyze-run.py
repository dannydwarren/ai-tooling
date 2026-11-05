import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True

from dd import aggregate, search

ENV = os.environ.get("DM_ENV", "dev")
OUTPUT_ROOT = Path(os.environ.get("DM_OUTPUT_ROOT", "C:/src/tmp/dotnet-api2-runs"))
SINCE_HOURS = int(os.environ.get("DM_SINCE_HOURS", "6"))
LEAD = timedelta(seconds=10)
TAIL = timedelta(minutes=3)
SETTLE = timedelta(minutes=3)
IDS_ROUTE = "api2/activities/ids/{type}/{id}/{relationshipDepth}"
STARTUP_FAILURES = '("Unable to resolve service" OR "Must Pass in Worker Names" OR "is not a valid worker")'


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def g(at, dotted):
    if not isinstance(at, dict):
        return None
    if dotted in at:
        return at[dotted]
    cur = at
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def attrs(r):
    return r.get("attributes", {}).get("attributes", {}) or {}


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: analyze-run.py <runId>")
    run_id = sys.argv[1]
    run_dir = OUTPUT_ROOT / run_id
    summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
    rows = [json.loads(l) for l in (run_dir / "merged.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]

    first, last = parse(summary["window"]["firstWrite"]), parse(summary["window"]["lastWrite"])
    wait = (last + SETTLE - datetime.now(timezone.utc)).total_seconds()
    if wait > 0:
        print(f"waiting {int(wait)}s for log ingestion")
        time.sleep(wait)
    frm, to = iso(first - LEAD), iso(last + TAIL)
    since = iso(datetime.now(timezone.utc) - timedelta(hours=SINCE_HOURS))
    now = iso(datetime.now(timezone.utc))
    problems = []
    report = {"runId": run_id, "env": ENV, "window": {"from": frm, "to": to}, "since": since}

    api2_calls = [r for r in rows if r.get("base") == "api2"]
    harness = search(f"service:api2 env:{ENV} @main:true @url.query:*dm-{run_id}-*", frm, to, limit=200)
    seen = {}
    for r in harness:
        a = attrs(r)
        q = g(a, "url.query") or ""
        mk = next((p.split("=", 1)[1] for p in q.split("&") if p.startswith("probe=")), None)
        seen[mk] = {
            "status": g(a, "http.response.status_code"),
            "route": g(a, "http.route"),
            "outcome": g(a, "outcome"),
        }
    report["harness"] = {"calls": len(api2_calls), "wideEvents": len(seen)}
    for r in api2_calls:
        ev = seen.get(r["marker"])
        if ev is None:
            problems.append(f"no api2 wide event for {r['lane']}/{r['case']}")
            continue
        if str(ev["status"]) != str(r["httpStatus"]):
            problems.append(f"{r['lane']}/{r['case']}: harness saw {r['httpStatus']}, api2 logged {ev['status']}")
        if ev["outcome"] == "error":
            problems.append(f"{r['lane']}/{r['case']}: api2 outcome error on {ev['route']}")

    job = next((r["entityJnid"] for r in rows if r["case"] == "list-connected"), None)
    hydration = (
        aggregate(
            f'service:api2 env:{ENV} @main:true @http.route:"{IDS_ROUTE}" @url.path:(*{job}/connected* OR *{job}/Connected*)',
            frm, to, group_by="@http.response.status_code",
        )
        if job
        else []
    )
    report["hydrationHop"] = {str(b.get("@http.response.status_code")): c for b, c in hydration}
    if job and not any(str(b.get("@http.response.status_code")) == "200" and c for b, c in hydration):
        problems.append("Connected list did not produce a 200 on GET /api2/activities/ids for the fixture job")

    fivexx = aggregate(
        f"service:api2 env:{ENV} @main:true @http.response.status_code:>=500", frm, to, group_by="@http.route"
    )
    report["api2FiveXxInWindow"] = {str(b.get("@http.route")): c for b, c in fivexx}

    errors = search(f"service:api2 env:{ENV} status:error", frm, to, limit=50)
    report["api2ErrorLinesInWindow"] = sorted(
        {(r.get("attributes", {}).get("message") or "")[:160] for r in errors}
    )

    startup = aggregate(f"service:(api2 OR worker) env:{ENV} {STARTUP_FAILURES}", since, now, group_by="service")
    report["startupFailuresSince"] = {str(b.get("service")): c for b, c in startup}
    if any(c for _, c in startup):
        problems.append(f"DI or worker-name startup failures since {since}: {report['startupFailuresSince']}")

    engage = aggregate(
        f"service:worker env:{ENV} status:error (engage_activity OR EngageActivity)", since, now, group_by="service"
    )
    report["engageActivityErrorsSince"] = {str(b.get("service")): c for b, c in engage}

    report["problems"] = problems
    report["clean"] = not problems and summary.get("clean", False)
    (run_dir / "analysis.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps({k: v for k, v in report.items() if k != "api2ErrorLinesInWindow"}, indent=2))
    if report["api2ErrorLinesInWindow"]:
        print("\napi2 error lines in the window (whole environment, review only):")
        for m in report["api2ErrorLinesInWindow"]:
            print(f"  {m}")
    sys.exit(0 if report["clean"] else 1)


if __name__ == "__main__":
    main()
