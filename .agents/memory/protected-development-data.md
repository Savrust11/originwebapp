---
name: Protected development data
description: Why ordinary development DBs must not be used for integration-test setup or cleanup.
---

Treat the normal development DB as protected existing data, not an expendable test database.

**Why:** The user confirmed that it already contains data and explicitly chose newly created, ownership-verified temporary PostgreSQL clusters for tests. “Development,” a different DB name, localhost, or synthetic family IDs do not establish permission to write or reset existing storage.

**How to apply:** Keep test setup, schema preparation, fixture writes, and cleanup within the cluster created by that run. Prove a creation/start/stop/delete lifecycle first, then use a fresh cluster for the suites. Never switch to the managed development DB or an external service to work around a test failure without separate permission.

## Offline verification boundaries

Do not weaken the no-network/no-listening policy just because a build launcher
is rejected.

**Why:** Tooling can open an internal IPC listener even during compilation.
That is different from the application requiring a running server or DB.

**How to apply:** Distinguish launcher behavior from application behavior and
use an offline execution path while retaining the guard and clean environment.

## Validation entries shown as workflows

Use validation-command management when updating a registered test check, even
when its failure is displayed alongside normal application workflows.

**Why:** The platform rejects attempts to convert an existing validation entry
into a regular workflow. A shared workflow status display does not mean the two
entry types accept the same configuration operation.

**How to apply:** Preserve the validation type and its safety guard; update its
command to the explicitly clean-environment test entrypoint rather than
changing the normal application's configuration or bypassing the guard.

## Local document checks without starting the app

For an offline-only document, use a file URL and a locally available browser,
not the application's server or a temporary HTTP listener. Discover an installed
Chromium executable rather than downloading a missing Playwright browser.

**Why:** The Playwright package can be installed while its bundled browser is
absent. The available system browser can render local files without activating
the app or touching its database. Its default fonts may lack Japanese glyphs.

**How to apply:** Use a clean environment, offline browser context, blocked
non-file/non-data page requests and disabled background networking. Reuse a
licensed local Japanese font when needed and inspect the rendered text; correct
DOM text alone does not prove that Japanese is visible.