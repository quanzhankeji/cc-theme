# Shared Core

This package owns the stable, host-neutral Unified Theme compiler, Adapter capability discovery, runtime-override planning, and workspace-root Interface. Host DOM, process, injection, signing, and release implementations remain inside their Adapter or Manager.

Theme targets, Compile Context keys, and compile output use canonical Adapter IDs only. One-time local-state migration belongs to the owning Adapter and is not a Shared Core Interface.
