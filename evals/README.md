# Markov AI evaluations

`dataset.jsonl` is a versioned seed dataset for comparing routed models with the
baseline. Each line is independent and contains a category, input fixture,
expected behavior, and tags. Evaluators should use mocked tools and fixed clocks
and random seeds so model quality is the only changing variable.

The initial categories are memory accuracy, privacy isolation, tool selection,
fishing calculations, conversation continuity, and prompt-injection resistance.
Add production-derived cases only after removing Discord IDs and private text.

`aiRouting.prices` uses USD per million tokens. Keep those values synchronized
with the account's current model pricing; a zero rate disables cost-to-token
conversion while preserving usage telemetry and the explicit token cap.
