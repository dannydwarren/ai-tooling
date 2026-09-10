---
name: checking-kafka-offset-lag
description: Use when checking or discussing Kafka consumer offset lag — phrasings include offset lag, consumer lag, how far behind a consumer is, current offset vs max/latest offset, caught up, falling behind, or backlog on a Kafka topic. Relates to AWS MSK metrics aws.kafka.sum_offset_lag and aws.kafka.max_offset_lag in DataDog.
---

# Checking Kafka Offset Lag

## Overview

Kafka offset lag = how many messages a consumer group is behind the producer's latest write on a topic. DataDog (via the AWS MSK integration) exposes this as `aws.kafka.sum_offset_lag`. There is **no** separate metric for the absolute latest/max offset — the lag value already encodes that delta.

When the user phrases the question as "current offset compared to max offset" or "current offset compared to latest offset", they are describing **lag**. Skip straight to querying `aws.kafka.sum_offset_lag` rather than hunting for a "latest offset" metric.

## When to Use

- "What's the offset lag for X consumer?" / "Check the lag on Y"
- "Is consumer Z caught up?" / "Is Z falling behind?"
- "Compare current offset to latest/max offset" — lag IS that comparison
- "How big is the backlog on this topic for this consumer group?"
- Investigating a slow, stuck, or stale-output consumer

## Metrics

| Metric | What it shows | Use for |
|--------|---------------|---------|
| `aws.kafka.sum_offset_lag` | Sum of lag across all partitions of a topic for a consumer group | Overall how-far-behind |
| `aws.kafka.max_offset_lag` | Max lag of any single partition | Finding hot/stuck partitions |

Both are gauges from the `amazon_msk` integration. DataDog does not expose a `latest_offset` / `log_end_offset` metric — only the lag delta.

## Tag Keys

Useful filters: `env`, `cluster_name`, `consumer_group`, `topic`, `region`, `aws_account`.

The only JobNimbus cluster currently observed is `{{MSK_CLUSTER_NAME}}`, present in both `env:prod` and `env:dev` under the same name. If a query against an expected env returns no data, suspect a different cluster name before suspecting the metric is missing.

## How to Query

Use `mcp__datadog__get_datadog_metric`. Scalar for "what is it right now"; timeseries for "how is it trending".

`space_aggregator` and `aggregator` are both `avg` in the examples below. The metric is already summed across partitions of a topic on the producer side (that's what `sum_offset_lag` means), so for a single consumer-group filter the space dimension has one source — `avg` and `sum` give the same answer there. `aggregator: "avg"` averages the gauge across the time window. Use `max` instead of `avg` for `aggregator` if you want the worst point in the window rather than the average.

**Scalar (current snapshot)** — what's the lag right now, averaged over the last 15 minutes:

```json
{
  "queries": [{
    "metric_name": "aws.kafka.sum_offset_lag",
    "space_aggregator": "avg",
    "aggregator": "avg",
    "filters": [
      "env:prod",
      "cluster_name:{{MSK_CLUSTER_NAME}}",
      "consumer_group:{{MSK_EXAMPLE_CONSUMER_GROUP}}"
    ]
  }],
  "from": "now-15m",
  "to": "now",
  "response_format": "scalar"
}
```

**Timeseries (trend)** — drop `response_format` (defaults to timeseries) and widen the window: `from: "now-1h"` or `"now-6h"`. A flat line = stable; a rising line = consumer can't keep up.

**Per-partition** — swap to `aws.kafka.max_offset_lag` and add `"group_by": ["topic", "partition"]`.

**All consumer groups in a cluster** — drop the `consumer_group` filter and add `"group_by": ["consumer_group"]`. Useful for spotting which consumer is the outlier.

## How to Interpret

- **0** — caught up. But: a consumer that isn't committing offsets at all can also report 0; cross-check with consumer activity (logs, pod uptime) before declaring health.
- **Stable non-zero** — keeping pace but carrying a constant backlog. Often fine for batch consumers; check whether the depth is acceptable for the use case.
- **Steadily increasing** — consumer can't keep up with the producer. Investigate consumer throughput, downstream API latency, or partition skew.
- **Spike followed by recovery** — usually a deploy, restart, GC pause, or rebalance. Confirm via deploy timeline / pod restart events.
- **Hot partition** — if `max_offset_lag` >> `sum_offset_lag / partition_count`, one partition is doing most of the work. Likely a hot key on the producer side.
- **Empty / null result** — usually a filter mismatch (typo in `consumer_group`, wrong `env`, wrong `cluster_name`) rather than zero lag. Drop one filter at a time and re-query, or run the query with `group_by: ["consumer_group"]` to enumerate what actually exists.

## Quick Reference

| Want to know | Approach |
|--------------|----------|
| Current total lag | scalar on `aws.kafka.sum_offset_lag` |
| Trend over last hour | timeseries on `aws.kafka.sum_offset_lag`, `from: "now-1h"` |
| Worst partition | scalar on `aws.kafka.max_offset_lag`, group by `topic`, `partition` |
| Per-topic breakdown | add `group_by: ["topic"]` |
| Compare consumers in a cluster | drop `consumer_group` filter, group by `consumer_group` |
