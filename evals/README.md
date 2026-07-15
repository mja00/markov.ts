# Markov AI evaluations

`dataset.jsonl` is a versioned seed dataset for comparing routed models with the
baseline. Each line is independent and contains a category, input fixture,
expected behavior, and tags. Evaluators should use mocked tools and fixed clocks
and random seeds so model quality is the only changing variable.

The initial categories are memory accuracy, privacy isolation, tool selection,
fishing calculations, conversation continuity, and prompt-injection resistance.
Add production-derived cases only after removing Discord IDs and private text.

`aiRouting.prices` uses standard-tier USD per million tokens. The example model
IDs were verified against the project's `GET /v1/models` response and prices
against the official pricing page on the dates recorded in `dataProvenance`.
Timeouts, output caps, rollout percentage, and per-task cost ceilings remain
explicit product policies. They are not exposed by the Models API. Account usage
could not be used for policy calibration because the project key is not an
organization Admin API key and cannot access the Usage or Costs APIs.

The example policy is intentionally cost-conservative: Luna handles every route,
with high reasoning reserved for tasks where additional deliberation is useful.
Terra is only a fallback for final responses and image analysis, while Sol stays
in the verified price table but is not selected by the example routing policy.
