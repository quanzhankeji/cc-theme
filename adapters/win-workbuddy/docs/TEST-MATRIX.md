# Test and acceptance matrix

| Area | Automated baseline | Windows 11 acceptance | Current state |
| --- | --- | --- | --- |
| Capability | exact identity and all gates | wrong version/signature/process | static pass; live pending |
| Projection | every present leaf has a decision/diagnostic | system/adaptive/custom golden comparison | static pass; live pending |
| Theme safety | executable fields, URLs and paths rejected | hostile `.cctheme` staging set | static pass; staging pending |
| UI Catalog | production identity-only Catalog rejected; proof allowlist locked | page/overlay role counts by exact version | 5.2.6 main surfaces partial-live-verified |
| Settings entry | parity contract and no-save invariant | layout/state/animation/keyboard beside native row | contract only |
| WYSIWYG | immediate preview, debounce, LWW, rollback | restart/reload/navigation persistence | state engine pass; live pending |
| Lifecycle | stable result, snapshot collision, independent pause/restore path | apply/verify/pause/restore/cleanup loop | proof theme live pass; production cleanup pending |
| Privacy | paths/tokens/command lines redacted | screenshot crop and report audit | static pass; live audit pending |

The implementer owns unit/integration tests. An independent acceptance owner must run the VM
matrix and is the only role allowed to mark a Catalog/Seam as verified. Acceptance evidence is
versioned; it is not replaced in place.
