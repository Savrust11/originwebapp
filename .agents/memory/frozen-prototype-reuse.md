---
name: Reusing frozen evidence prototypes
description: Why isolated connection work adapts frozen modules at load time rather than editing their archived implementations.
---

Reuse frozen prototype logic without rewriting the implementations covered by
historical preservation manifests. Prefer small, explicitly checked load-time
adapters when a private test needs an unexported renderer or a non-app lifecycle.

**Why:** Editing an old helper merely to export a function would invalidate
preserved evidence from an already completed evaluation. Copying and redesigning
its behavior would instead make a claimed reuse inaccurate.

**How to apply:** Assert each adaptation has one expected anchor, record original
and adapted hashes, and preserve original files. Keep owner/isolation/cleanup
checks intact. A private draft-selection adapter is not permission to activate,
review or publish candidates; demonstrate separately that the ordinary search
still excludes them. Do not introduce this evaluation adapter into normal routes.

## Validate adapter initialization before diagnosing storage

An isolated wrapper must preserve the canonical launcher's process ancestry,
not just import its lifecycle function. Ownership and ancestry are independent
authorization checks.

**Why:** A genuinely new owned cluster still failed managed authorization when
the canonical launcher was only imported by a differently named entrypoint.

**How to apply:** Keep the canonical launcher as an owned child under the
checked adapter; do not relax managed authorization to accommodate a wrapper.
Bind completion to the current invocation and explicit cleanup evidence rather
than treating any pre-existing report as proof of the current run.

Clean-environment Node wrappers can introduce `PWD` and `SHLVL` after `env -i`.

**Why:** Rejecting every extra key can stop a genuinely clean invocation before
its safety checks; broadly accepting environment additions would be unsafe.

**How to apply:** If these shell metadata are needed, validate the working
directory and numeric nesting level specifically. Keep database, credential,
preload and network overrides forbidden.

Check that a composed loader can reach the existing authorization denial using
a pure, unauthorized import before attempting an owned integration run.

**Why:** Re-entrant loader initialization can terminate silently before the
authorization guard or database setup runs. That is not evidence that the
ownership guard needs relaxing or the database needs replacing.

**How to apply:** Keep loader initialization independent of its own unresolved
delegation. Use the expected authorization rejection as the no-storage smoke
check, then run the unchanged owned-storage lifecycle.