# Proposal to Windows and CC Theme leads

No shared file has been changed. Win-Claude proposes:

1. authoritative Adapter ID: `win-claude`; legacy aliases, if any, should be
   decided centrally rather than invented here;
2. register Capability, Style Catalog, Target Profile, and projector only after
   this project's offline projection and target normalizer exist;
3. extend the Manager's adapter request/result adapter-ID admission to
   `win-claude` in the same coordinated change as registry discovery;
4. define the Manager-to-Adapter Unified Theme v2 projection invocation against
   `sharedCore`, not the older Mac-Claude `identity/colors/...` request variant;
5. map Manager Compile Context's `adapters.win-claude` entry to the adapter-owned
   package identity and Surface Catalog fields without writing those facts back
   into theme data;
6. keep `resume` out of the shared operation enum: Win-Claude uses `apply` after
   `pause` unless the shared owners deliberately approve a new product operation;
7. normalize Windows-only `client-identity-untrusted` if the shared result code
   vocabulary needs to distinguish package trust from version support.

Until these items are agreed, this project remains locally discoverable only and
publishes `compileAvailable=false`, `runtimeApplyAvailable=false`.
