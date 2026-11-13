# Saved queries

Run any of these with `bin/sql "<query>"` (add `--json` for JSON). It downloads the environment's file from R2, or reads `DB_FILE`. `test/queries.test.ts` runs every `sql` block below against a seeded database, so a schema change that breaks one fails the tests.

How the interaction log reads:

- One `attempt()` writes one `interaction` row per ladder step it tried. The first step's row has `parent` null; the later steps name it in `parent`. So `coalesce(parent, id)` groups the rows of one attempt.
- `fallback` is the step that row tried (`live`, `last_good`, `unknown`, ...). The ladder stops at the first step whose `outcome` is `ok`, so that row's `fallback` is the step that produced the value. An attempt with no `ok` row produced nothing.
- Only `live` and `google` steps call a provider. `last_good`, `unknown`, `estimate` (Routes' distance estimate), `known` and `area` (geocoding from our tables) and `places` (stays from our tables) read our own data, so the call and cost queries leave them out. A `live` row with outcome `blocked` was refused before or by the provider (`BLOCK_CHANNELS`, the per-person slot read cap, a 403).
- Times are UTC ISO strings, and days below are UTC days.
- Calls with no `place` put `city` in `request` when they know it, for the cost query.
- Write conflicts on the database file (412 on upload) are in the function logs as `db.conflict`, not in this file.

## Failure rate by channel and day

Provider calls only.

```sql
SELECT substr(at, 1, 10) AS day, channel, count(*) AS calls,
  sum(outcome = 'error') AS errors, sum(outcome = 'timeout') AS timeouts,
  sum(outcome = 'blocked') AS blocked, sum(outcome = 'empty') AS empty,
  round(100.0 * sum(outcome IN ('error', 'timeout', 'blocked')) / count(*), 1) AS failure_pct
FROM interaction
WHERE fallback IN ('live', 'google')
GROUP BY day, channel
ORDER BY day DESC, failure_pct DESC
```

## Which ladder step produced the value

```sql
WITH attempts AS (
  SELECT coalesce(parent, id) AS attempt, channel, kind,
    max(CASE WHEN outcome = 'ok' THEN fallback END) AS produced_by
  FROM interaction
  GROUP BY attempt, channel, kind
)
SELECT channel, kind, coalesce(produced_by, '(nothing)') AS step, count(*) AS attempts,
  round(100.0 * count(*) / sum(count(*)) OVER (PARTITION BY channel, kind), 1) AS pct
FROM attempts
GROUP BY channel, kind, step
ORDER BY channel, kind, attempts DESC, step
```

## Slot reads that fell back this week, by restaurant

The last 7 days. A read fell back when anything other than `live` produced it.

```sql
WITH reads AS (
  SELECT coalesce(parent, id) AS attempt, place, min(at) AS at,
    max(CASE WHEN outcome = 'ok' THEN fallback END) AS produced_by
  FROM interaction
  WHERE kind = 'slots.read'
  GROUP BY attempt, place
)
SELECT reads.place, place.name, count(*) AS reads,
  sum(coalesce(produced_by, '') <> 'live') AS fell_back,
  round(100.0 * sum(coalesce(produced_by, '') <> 'live') / count(*), 1) AS fell_back_pct,
  sum(produced_by = 'last_good') AS last_good, sum(produced_by IS NULL) AS no_value
FROM reads LEFT JOIN place ON place.id = reads.place
WHERE reads.at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')
GROUP BY reads.place
ORDER BY fell_back_pct DESC, reads DESC
```

## Stale facts per city

A curated place's field is stale when its newest shared fact (any source but `user:`) is older than the field's window from the plan's freshness rules: hours 7 days; status, price and menu 30 days.

```sql
WITH windows (field, days) AS (VALUES ('hours', 7), ('status', 30), ('price_pp', 30), ('menu', 30)),
newest AS (
  SELECT place, field, max(checked_at) AS checked_at FROM fact
  WHERE source NOT LIKE 'user:%' GROUP BY place, field
)
SELECT place.city, newest.field, count(*) AS stale, min(newest.checked_at) AS oldest
FROM newest
JOIN place ON place.id = newest.place AND place.curated = 1
JOIN windows ON windows.field = newest.field
WHERE newest.checked_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-' || windows.days || ' days')
GROUP BY place.city, newest.field
ORDER BY place.city, stale DESC
```

## Which Lima facts are stale

The same rule, one row per place and field.

```sql
WITH windows (field, days) AS (VALUES ('hours', 7), ('status', 30), ('price_pp', 30), ('menu', 30)),
newest AS (
  SELECT place, field, max(checked_at) AS checked_at FROM fact
  WHERE source NOT LIKE 'user:%' GROUP BY place, field
)
SELECT place.id, place.name, newest.field, newest.checked_at,
  cast(julianday('now') - julianday(newest.checked_at) AS integer) AS age_days, windows.days AS window_days
FROM newest
JOIN place ON place.id = newest.place AND place.curated = 1 AND place.city = 'lima'
JOIN windows ON windows.field = newest.field
WHERE newest.checked_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-' || windows.days || ' days')
ORDER BY age_days DESC
```

## Model and API cost per city

Provider calls only. `unpriced` counts calls with no `cost_usd`, such as Google calls that record a `sku` in `request` for pricing later.

```sql
SELECT coalesce(place.city, json_extract(interaction.request, '$.city'), '(none)') AS city,
  interaction.channel, substr(interaction.at, 1, 7) AS month, count(*) AS calls,
  round(sum(coalesce(interaction.cost_usd, 0)), 4) AS cost_usd,
  sum(interaction.cost_usd IS NULL) AS unpriced
FROM interaction LEFT JOIN place ON place.id = interaction.place
WHERE interaction.fallback IN ('live', 'google')
-- By position: a bare "city" here would group by place.city, splitting calls that carry the city in request.
GROUP BY 1, 2, 3
ORDER BY month DESC, cost_usd DESC
```

## Recent attempts, step by step

```sql
SELECT coalesce(parent, id) AS attempt, at, channel, kind, place, fallback AS step, outcome, latency_ms, error
FROM interaction
ORDER BY coalesce((SELECT at FROM interaction AS root WHERE root.id = interaction.parent), at) DESC, at
LIMIT 50
```

## Requests that might hold an email

A coarse check from SQL alone; `test/attempt.test.ts` runs the full phone, email and passport patterns, and `attempt()` redacts matches before writing.

```sql
SELECT id, at, channel, kind, request FROM interaction
WHERE request LIKE '%@%.%'
```

## Voice inputs that were undone

Each `input.interpret` or `/api/voice` call that changed something writes one `input_undo` row: `media` is the voice clip (null for typed input), `interaction` the interpret call, and `undone_at` is set when `input.undo` reverts it. Inputs that changed nothing write no row.

```sql
SELECT substr(created_at, 1, 10) AS day,
  CASE WHEN media IS NULL THEN 'typed' ELSE 'voice' END AS input,
  count(*) AS inputs, sum(undone_at IS NOT NULL) AS undone,
  round(100.0 * sum(undone_at IS NOT NULL) / count(*), 1) AS undone_pct
FROM input_undo
GROUP BY day, input
ORDER BY day DESC, input
```
