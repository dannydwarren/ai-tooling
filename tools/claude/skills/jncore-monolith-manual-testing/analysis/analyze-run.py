import json
import os
import re
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True

from dd import aggregate, search

SKILL = Path(__file__).resolve().parent.parent
ENV = os.environ.get("A2125_ENV", "dev")
OUTPUT_ROOT = Path(os.environ.get("A2125_OUTPUT_ROOT", "C:/src/tmp/jncore-api1-runs"))
LEAD = timedelta(seconds=10)
TAIL = timedelta(minutes=4)
SETTLE = timedelta(minutes=3)

JNCORE = "(nodeapi OR nodeapi-files OR nodeapi-files-url OR nodefarm OR nodefarm-gs OR nodefarm-worker OR qbwc OR file-upload-postprocessor)"
NODEAPI = "(nodeapi OR nodeapi-files OR nodeapi-files-url)"
RELATED_QUEUES = "(@tags:related_objects_update OR @tags:related_objects_update_for_location)"
EXPECTED_DELIVERY_FAILURES = {"dev": {"hover-job-request"}, "prod": set()}
KNOWN_ERROR_LINES = [
    ("KI-1", "nodeapi", re.compile(r"^unhandledRejection: .*The key does not exist on the server")),
    ("KI-2", "nodeapi-files", re.compile(r"^Non-retried CB Error: invalid argument")),
    ("KI-3", "nodefarm", re.compile(r"^Non-retried CB Error: invalid argument")),
    ("KI-3", "nodefarm", re.compile(r"^Failure outside invalid argument")),
    ("webhook", "nodefarm", re.compile(r"^Error in calling http://test\.com")),
]


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


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def is_success(status):
    return 200 <= int(status or 0) < 300


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_run(run_dir):
    rows = [json.loads(l) for l in (run_dir / "merged.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    summary = read_json(run_dir / "summary.json")
    checks_file = run_dir / "on" / "M" / "checks.json"
    checks = read_json(checks_file) if checks_file.exists() else None
    return rows, summary, checks


def settle(last_write):
    ready = last_write + SETTLE
    wait = (ready - datetime.now(timezone.utc)).total_seconds()
    if wait > 0:
        sys.stderr.write(f"waiting {int(wait)} s for log ingestion to settle\n")
        time.sleep(wait)


def profile(rows, summary):
    baseline = read_json(SKILL / "baselines" / f"{ENV}.json")
    by_status = dict(sorted(Counter(str(r.get("httpStatus")) for r in rows).items()))
    non_success = sorted(f"{r.get('lane')}:{r.get('case')}:{r.get('httpStatus')}" for r in rows if not is_success(r.get("httpStatus")))
    return {
        "calls": len(rows),
        "baselineCalls": baseline["calls"],
        "byStatus": by_status,
        "baseline": dict(sorted(baseline["byStatus"].items())),
        "matchesBaseline": len(rows) == baseline["calls"] and by_status == dict(sorted(baseline["byStatus"].items())),
        "nonSuccess": non_success,
        "expectedNonSuccess": sorted(baseline["expectedNonSuccess"]),
        "lanes": summary.get("lanes", []),
    }


def worker_correlation(ids, frm, to):
    worker_rows = []
    for jnid in ids.values():
        for r in search(f"env:{ENV} service:worker @tags:{jnid}", frm, to, 200):
            at = attrs(r)
            worker_rows.append({
                "ts": r["attributes"].get("timestamp"),
                "status": r["attributes"].get("status"),
                "queue": g(at, "fields.worker.queue"),
                "correlationId": g(at, "fields.jn-correlation-id") or at.get("correlation-id"),
                "entity": jnid,
                "msg": (r["attributes"].get("message") or "")[:160],
            })
    http_ids = set()
    for cid in sorted({w["correlationId"] for w in worker_rows if w["correlationId"]}):
        for r in search(f'env:{ENV} @main:true service:nodeapi @correlationId:"{cid}"', frm, to, 5):
            if attrs(r).get("correlationId"):
                http_ids.add(attrs(r)["correlationId"])
    generated = [w for w in worker_rows if str(w["correlationId"] or "").startswith("dotnet-worker_")]
    return {
        "workerLogs": len(worker_rows),
        "workerLogsByQueue": dict(Counter(w["queue"] for w in worker_rows)),
        "workerErrors": [w for w in worker_rows if w["status"] in ("error", "warn")],
        "generatedIds": len(generated),
        "idsFromNodeapiRequests": sum(1 for w in worker_rows if w["correlationId"] in http_ids),
        "otherIds": sorted({w["correlationId"] for w in worker_rows if w["correlationId"] not in http_ids and w not in generated}),
        "sample": worker_rows[:8],
    }


def deliveries(frm, to):
    failures = []
    for r in search(f"env:{ENV} @main:true service:(nodefarm OR nodefarm-gs) @outcome:error", frm, to, 50):
        at = attrs(r)
        failures.append({
            "ts": r["attributes"].get("timestamp"),
            "service": r["attributes"].get("service"),
            "messageType": g(at, "message_type"),
            "queue": g(at, "messaging.destination.name"),
            "disposition": g(at, "disposition"),
            "attempts": g(at, "attempts"),
            "error": (g(at, "error.message") or "")[:200],
        })
    return {
        "nodefarmByDisposition": aggregate(f"env:{ENV} @main:true service:nodefarm @message_type:*", frm, to, "@disposition", expect_rows=True),
        "nodefarmGsByDisposition": aggregate(f"env:{ENV} @main:true service:nodefarm-gs @message_type:*", frm, to, "@disposition", expect_rows=True),
        "failures": failures,
        "destinationIsRabbit": aggregate(f"env:{ENV} @main:true service:(nodefarm OR nodefarm-gs) @messaging.destination.name:rabbitmq", frm, to),
    }


def legacy_lines(frm, to):
    return {
        "jnmqError": aggregate(f"env:{ENV} @tags:jnmq-error", frm, to, "service"),
        "dlqLine": aggregate(f'env:{ENV} service:(nodefarm OR nodefarm-gs) "exceeded max retries"', frm, to),
        "dropLine": aggregate(f'env:{ENV} "Message dropped by drop filter"', frm, to),
    }


def http(frm, to):
    return {
        "nodeapiByOutcome": aggregate(f"env:{ENV} @main:true service:{NODEAPI}", frm, to, "@outcome", expect_rows=True),
        "nodeapi5xx": [
            {
                "ts": r["attributes"].get("timestamp"),
                "service": r["attributes"].get("service"),
                "route": g(attrs(r), "http.route"),
                "status": g(attrs(r), "http.response.status_code"),
            }
            for r in search(f"env:{ENV} @main:true service:{NODEAPI} @http.response.status_code:>=500", frm, to, 50)
        ],
    }


def error_lines(frm, to):
    registered = Counter()
    unregistered = Counter()
    for r in search(f"env:{ENV} service:{JNCORE} status:error -@main:true", frm, to, 500):
        service = r["attributes"].get("service")
        message = r["attributes"].get("message") or ""
        ref = next((k for k, svc, rx in KNOWN_ERROR_LINES if svc == service and rx.search(message)), None)
        if ref:
            registered[f"{ref} | {service} | {message[:80]}"] += 1
        else:
            unregistered[f"{service} | {message[:120]}"] += 1
    return {
        "registered": registered.most_common(),
        "unregistered": unregistered.most_common(25),
    }


def problems_in(report):
    problems = []
    p = report["profile"]
    for lane in p["lanes"]:
        if lane.get("outcome") != "completed":
            problems.append(f"lane {lane.get('lane')} {lane.get('outcome')}")
    if not p["matchesBaseline"]:
        problems.append(f"status profile {p['calls']} calls {p['byStatus']} differs from baseline {p['baselineCalls']} calls {p['baseline']}")
    if p["nonSuccess"] != p["expectedNonSuccess"]:
        problems.append(f"non-2xx {p['nonSuccess']} differ from expected {p['expectedNonSuccess']}")
    lane_m = report["laneM"]
    if lane_m is None:
        problems.append("lane M wrote no checks.json")
    else:
        problems += [f"lane M: {c['check']} failed" for c in lane_m["checks"] if not c["ok"]]
        c = report["correlation"]
        if c["workerLogs"] == 0:
            problems.append("no .NET worker logs for lane M's records")
        if c["generatedIds"]:
            problems.append(f"{c['generatedIds']} worker logs carry a generated dotnet-worker_ correlation id")
        if c["workerErrors"]:
            problems.append(f"{len(c['workerErrors'])} worker error/warn lines on lane M's records")
    if report["workerQueueErrors"]:
        problems.append(f"worker errors on the related-objects queues: {report['workerQueueErrors']}")
    expected_failures = EXPECTED_DELIVERY_FAILURES.get(ENV, set())
    unexpected = [f for f in report["deliveries"]["failures"] if f["messageType"] not in expected_failures]
    if unexpected:
        problems.append(f"{len(unexpected)} delivery failures outside {sorted(expected_failures)}")
    if report["deliveries"]["destinationIsRabbit"]:
        problems.append("wide events with messaging.destination.name:rabbitmq")
    for name, rows in report["legacyLines"].items():
        if rows:
            problems.append(f"legacy {name} lines: {rows}")
    harness_5xx = sum(1 for r in p["nonSuccess"] if r.endswith(":500"))
    if len(report["http"]["nodeapi5xx"]) != harness_5xx:
        problems.append(f"{len(report['http']['nodeapi5xx'])} nodeapi 5xx wide events, harness saw {harness_5xx}")
    return problems


def main():
    run_id = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("A2125_RUN_ID")
    if not run_id or not re.fullmatch(r"[a-z0-9]{6,12}", run_id):
        sys.exit("pass the run id as the first argument or A2125_RUN_ID")
    run_dir = OUTPUT_ROOT / run_id
    rows, summary, checks = load_run(run_dir)

    first, last = parse(summary["window"]["firstWrite"]), parse(summary["window"]["lastWrite"])
    settle(last)
    frm, to = iso(first - LEAD), iso(min(last + TAIL, datetime.now(timezone.utc)))

    report = {
        "runId": run_id,
        "env": ENV,
        "window": [frm, to],
        "profile": profile(rows, summary),
        "laneM": checks and {"ids": checks["ids"], "locations": checks["locations"], "checks": checks["checks"]},
        "correlation": worker_correlation(checks["ids"], frm, to) if checks else None,
        "workerQueueErrors": aggregate(f"env:{ENV} service:worker status:error {RELATED_QUEUES}", frm, to),
        "deliveries": deliveries(frm, to),
        "legacyLines": legacy_lines(frm, to),
        "http": http(frm, to),
        "errorLines": error_lines(frm, to),
    }
    report["problems"] = problems_in(report)
    report["clean"] = not report["problems"]

    out = run_dir / "analysis.json"
    out.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(f"window   {frm} .. {to}")
    print(f"verdict  {'clean' if report['clean'] else 'PROBLEMS'}")
    for p in report["problems"]:
        print(f"  - {p}")
    if report["errorLines"]["unregistered"]:
        print("unregistered error lines (review, not counted as problems):")
        for line, n in report["errorLines"]["unregistered"]:
            print(f"  {n:>4}  {line[:140]}")
    print(f"report   {out}")
    sys.exit(0 if report["clean"] else 1)


if __name__ == "__main__":
    main()
