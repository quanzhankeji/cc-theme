({ initialState, validate, preview, persist, status = () => {}, debounceMs = 180 }) => {
  const clone = (value) => structuredClone(value);
  let committed = clone(validate(clone(initialState)));
  let draft = clone(committed);
  let revision = 0;
  let committedRevision = 0;
  let generation = 0;
  let timer = null;
  let disposed = false;
  let activePromise = null;
  let activeController = null;
  let lastError = null;

  const emit = (state, detail = {}) => status({ state,
    revision,
    committedRevision,
    ...detail,
  });

  const controller = () => typeof globalThis.AbortController === "function"
    ? new globalThis.AbortController()
    : {
      signal: { aborted: false },
      abort() { this.signal.aborted = true; },
    };

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const rollback = (error) => {
    lastError = String(error?.message || error);
    draft = clone(committed);
    revision = committedRevision;
    preview(clone(draft), { reason: "rollback", revision, error });
    emit("error", { code: "persist-failed", message: String(error?.message || error) });
  };

  const commitLoop = async () => {
    clearTimer();
    if (disposed) return clone(committed);
    if (activePromise) return activePromise;
    const loopGeneration = generation;
    activeController = controller();
    activePromise = (async () => {
      while (!disposed && generation === loopGeneration && committedRevision < revision) {
        const requestRevision = revision;
        const candidate = clone(draft);
        emit("saving", { requestRevision });
        try {
          const result = await persist(clone(candidate), {
            revision: requestRevision,
            generation: loopGeneration,
            signal: activeController.signal,
          });
          if (disposed || generation !== loopGeneration) return clone(committed);
          const persisted = validate(clone(result?.state ?? candidate));
          committed = clone(persisted);
          committedRevision = requestRevision;
          lastError = null;
          if (revision === requestRevision) {
            draft = clone(persisted);
            preview(clone(draft), { reason: "commit", revision });
            emit("saved", { requestRevision });
          }
        } catch (error) {
          if (disposed || generation !== loopGeneration || activeController.signal.aborted) return clone(committed);
          if (revision === requestRevision) {
            rollback(error);
            return clone(committed);
          }
          emit("saving", { code: "superseded-write-failed", requestRevision });
        }
      }
      return clone(committed);
    })().finally(() => {
      activePromise = null;
      activeController = null;
    });
    return activePromise;
  };

  const schedule = (immediate) => {
    clearTimer();
    if (immediate) return void commitLoop();
    timer = setTimeout(() => { void commitLoop(); }, debounceMs);
  };

  const update = (controlOrPatch, valueOrOptions, maybeOptions = {}) => {
    if (disposed) throw new Error("Theme settings session is disposed");
    const objectPatch = controlOrPatch && typeof controlOrPatch === "object" && !Array.isArray(controlOrPatch);
    const patch = objectPatch ? clone(controlOrPatch) : { [controlOrPatch]: clone(valueOrOptions) };
    const options = objectPatch ? (valueOrOptions ?? {}) : maybeOptions;
    if (!Object.keys(patch).length || Object.keys(patch).some((key) => typeof key !== "string" || !key)) {
      throw new Error("A settings patch is required");
    }
    const controlIds = Object.keys(patch);
    let candidate;
    const previousDraft = clone(draft);
    const previousRevision = revision;
    try {
      candidate = validate({ ...clone(draft), ...patch });
      draft = clone(candidate);
      revision = previousRevision + 1;
      preview(clone(candidate), { reason: "input", controlIds, revision });
    } catch (error) {
      draft = previousDraft;
      revision = previousRevision;
      lastError = String(error?.message || error);
      emit("error", { code: "validation-failed", message: lastError, controlIds });
      return false;
    }
    lastError = null;
    emit("dirty", { controlIds });
    schedule(options.immediate === true);
    return clone(draft);
  };

  const flush = async () => {
    clearTimer();
    return commitLoop();
  };

  const replaceBase = async (nextState) => {
    clearTimer();
    generation += 1;
    activeController?.abort();
    await activePromise?.catch(() => {});
    committed = clone(validate(clone(nextState)));
    draft = clone(committed);
    revision = 0;
    committedRevision = 0;
    lastError = null;
    preview(clone(draft), { reason: "replace-base", revision: 0 });
    emit("ready");
    return clone(draft);
  };

  const snapshot = () => ({
    draft: clone(draft),
    committed: clone(committed),
    revision,
    committedRevision,
    generation,
    pending: Boolean(timer || activePromise),
    disposed,
    lastError,
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    clearTimer();
    activeController?.abort();
    emit("disposed");
  };

  return { update, flush, replaceBase, snapshot, dispose };
}
