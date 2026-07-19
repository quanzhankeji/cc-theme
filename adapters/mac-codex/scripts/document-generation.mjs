class SupersededGenerationError extends Error {
  constructor() {
    super("Renderer document generation was superseded");
    this.name = "SupersededGenerationError";
  }
}

function requiredIdentity(value, label) {
  if (typeof value !== "string" || !value || value.length > 256) {
    throw new Error(`${label} must be a bounded non-empty string`);
  }
  return value;
}

export function createDocumentGenerationCoordinator() {
  let active = null;
  let committed = null;
  let sequence = 0;

  const cancel = () => {
    if (active) active.controller.abort();
    active = null;
    committed = null;
  };

  return {
    run(identity, task) {
      const documentId = requiredIdentity(identity?.documentId, "documentId");
      const generation = requiredIdentity(identity?.generation, "generation");
      if (typeof task !== "function") throw new Error("generation task must be a function");
      if (active?.documentId === documentId && active.generation === generation) return active.promise;
      if (committed?.documentId === documentId && committed.generation === generation) {
        return Promise.resolve({ status: "already-committed", value: committed.value });
      }

      cancel();
      const controller = new AbortController();
      const token = ++sequence;
      const isCurrent = () => active?.token === token && !controller.signal.aborted;
      const guard = () => {
        if (!isCurrent()) throw new SupersededGenerationError();
      };
      const record = { documentId, generation, token, controller, promise: null };
      record.promise = Promise.resolve()
        .then(() => task({ documentId, generation, signal: controller.signal, isCurrent, guard }))
        .then((value) => {
          if (!isCurrent()) return { status: "superseded" };
          committed = { documentId, generation, value };
          return { status: "committed", value };
        })
        .catch((error) => {
          if (error instanceof SupersededGenerationError || !isCurrent()) return { status: "superseded" };
          throw error;
        })
        .finally(() => {
          if (active?.token === token) active = null;
        });
      active = record;
      return record.promise;
    },
    cancel,
    current() {
      const record = active ?? committed;
      return record ? { documentId: record.documentId, generation: record.generation } : null;
    },
  };
}
