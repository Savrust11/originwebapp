---
name: Private file-based prototype previews
description: Why an owned offline desktop preview uses workspace VNC instead of a public-by-default development URL.
---

For a private prototype that must not use the normal app or existing database,
workspace VNC can expose an offline file-based browser backed by newly owned
temporary storage, without opening an HTTP preview server.

**Why:** Replit development URLs are public by default. The documented default
VNC access is within the workspace, avoiding an unverified assumption that a
development URL is private.

**How to apply:** Recheck current platform documentation and external-VNC
configuration before relying on this boundary. Inspect secret existence only,
never secret values. This is workspace-level access, not per-user confidential
medical storage; require fictional inputs and keep them in memory. Keep ownership
and managed-child guards, provide a graceful stop, impose a visible lifetime, and
verify the outer owner removes its temporary database after shutdown. An active
preview intentionally retains its owned environment until stop or timeout;
do not claim it has already been cleaned up while it is running.

## Regional support: deliberate official-link navigation

A private regional-support preview may let the user open rechecked municipal
official pages while keeping its own catalog and saved selections local.
Do not describe this mode as completely offline.

**Why:** Opening the official instructions is a required user action; an
all-network-blocked browser would make that action unusable. Private workspace
access and permission to read public official pages are separate boundaries.

**How to apply:** Keep official-page navigation explicitly user-initiated and
restricted to verified destinations, with no submissions or application/model
API calls. Test destination selection without actually calling, booking or
applying. Preserve the owned-profile lifetime and cleanup controls, and
distinguish closed test runs from a still-active interactive preview.