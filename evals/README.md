# Markov AI evaluations

`dataset.jsonl` is the blocking live-model dataset. Each line is independent and
contains a category, input fixture, expected behavior, and tags. Run it with:

```sh
npm run eval
```

The runner uses `OPENAI_API_KEY` when set, then falls back to
`openai.apiKey` in the ignored local `config/config.json`. CI uses the
`OPENAI_API_KEY` repository secret and fails when an active case does not match.
Forked pull requests and Dependabot do not receive secrets, so CI skips the live
step for those events.

Every category in the active dataset must have an implemented evaluator. Dataset
shape and evaluator coverage are checked by the normal unit-test suite, while
`npm run eval` sends each active case through the production intent prompt and
grades the structured result.

`backlog.jsonl` retains proposed cases that do not have executable harnesses yet;
it is intentionally non-blocking. Move a case into `dataset.jsonl` only after its
category has an evaluator. Add production-derived cases only after removing
Discord IDs and private text.

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
