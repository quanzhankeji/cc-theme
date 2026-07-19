# Reusable interfaces and Windows-owned adapters

## Reused as product/data interfaces

| Interface | Reused meaning | Win-Claude status |
| --- | --- | --- |
| Unified Theme v2 Shared Core | semantic tokens, one background mode, accessibility | static contract mapped; projector not implemented |
| Adapter Capability | truthful supported/approximated/unsupported decisions and visible diagnostics | local raw capability published, unavailable |
| Target Profile | closed adapter namespace validated after Shared Core | empty until real Windows evidence |
| Compile Context | client/version/catalog/probe/apply facts kept out of theme design data | local schema published; Manager mapping needs agreement |
| Local Runtime Overrides | stable token + theme/base hash + preserve/replay/quarantine | policy published; persistence seam unverified |
| Lifecycle | detect/preflight/install/apply/launch/verify/pause/restore | meanings published; implementation unverified |
| Operation result | bounded truthful status/code/details | local schema published |

## Must be implemented independently on Windows

- package/install identity and Authenticode verification;
- process, session, window, and architecture discovery;
- actual UI technology and version-scoped host landmarks;
- fixed transport and renderer attachment;
- runtime bindings from semantic roles to host surfaces;
- Windows storage root, ACL, cross-process lock, flush/replace semantics;
- symlink, junction, mount point, reparse point, hardlink, ADS, UNC, device-path,
  and mixed-separator defenses;
- stage/apply/verify/cleanup transaction and official-appearance recovery;
- UI Automation, DPI, keyboard, and motion acceptance.

Mac-Claude's exact client build, process names, paths, selectors, CDP behavior,
injection assets, and recovery steps are not Windows facts and are not reused.
