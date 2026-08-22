---
name: Artifact registration after restore
description: Workspace behavior when an existing artifact source tree is restored from an archive.
---

## Rule

An artifact directory and its workspace registration are separate states. Restoring `artifacts/<slug>` from an archive does not guarantee that the artifact is present in the workspace artifact list or can be presented.

**Why:** The restored Elite-Trade dashboard had valid source files and a running workflow, but preview/presentation rejected it until a registered artifact record was created.

**How to apply:** Preserve the source tree, register the artifact using the artifact lifecycle, keep the generated registration metadata, restore the original source over the scaffold, reinstall workspace links, and run the artifact-owned workflow.