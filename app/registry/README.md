# Adapter Registry

`adapter-capabilities.json` is the Manager-owned registry of stable Adapter IDs and Adapter-owned capability/projector files. Registry paths are relative to `adapters/` locally and to the bundled `adapters/` resource directory in a signed Manager build.

The currently registered public IDs are exactly `mac-codex` and `mac-workbuddy`. The Registry does not publish aliases; a preserved but unregistered Adapter source is not part of the Manager product or runtime resources.

Online discovery uses a signed two-step channel under `channels/stable.json` and an exact-commit Catalog under `catalogs/stable/`. The Manager verifies detached Ed25519 signatures over exact raw JSON bytes before parsing, persists the highest accepted sequence, and only downloads exact GitHub Release assets bound by signed size and SHA-256. The private signing key is never stored in this repository or GitHub Actions.
