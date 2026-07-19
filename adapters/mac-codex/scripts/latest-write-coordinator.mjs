export function createLatestWriteCoordinator() {
  let receiptCounter = 0;
  const lanes = new Map();

  const submit = (key, write) => {
    if (typeof key !== "string" || !key) throw new Error("Latest-write key must be a non-empty string");
    if (typeof write !== "function") throw new Error("Latest-write operation must be a function");
    const receipt = ++receiptCounter;
    const lane = lanes.get(key) ?? { latest: 0, chain: Promise.resolve() };
    lane.latest = receipt;
    lanes.set(key, lane);
    const work = lane.chain.catch(() => {}).then(async () => {
      if (receipt < lane.latest) return { receipt, superseded: true, value: null };
      const value = await write();
      return { receipt, superseded: receipt < lane.latest, value };
    });
    lane.chain = work;
    return work;
  };

  return Object.freeze({ submit });
}
