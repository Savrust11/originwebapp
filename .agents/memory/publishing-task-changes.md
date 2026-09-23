---
name: Publishing task changes
description: Avoid republishing a main project that has not received isolated task changes.
---

Before recommending republish, confirm the completed task changes have been applied to the main project, not merely committed in the task workspace.

**Why:** Isolated task previews and local production builds are not the publishing source. Republish cannot include changes that have not reached the main project.

**How to apply:** Distinguish task completion, application to the main project, and publishing. A locally named `main` branch alone does not establish that the publishing source contains the changes.