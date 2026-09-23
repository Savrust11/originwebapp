---
name: Behavioral preflight for bounded live trials
description: Why offline fault injection is required before a newly authorized paid model trial.
---

Static source checks alone are not sufficient evidence that a live-send budget
and stop policy work. Exercise the runner with an injected, non-network transport.

**Why:** Review of a statically passing preparation exposed reservation recovery
and response-validation gaps before any live calls. A process can die after
reserving a call but before recording its outcome; starting another scene must
not bypass that unresolved cost.

**How to apply:** Before first transmission, test missing credentials before
reservation, dangling reservations after a crash, unknown usage, unexpected
returned settings, immutable raw bytes, exclusive execution, historical ledger
integrity and absence of credentials from logs. Uncertainty stops the entire run
with its reservation retained. A known output-limit result with known usage is
different: record the cost and halt that scene without pretending the answer is
complete. Never infer answer quality from these engineering checks.