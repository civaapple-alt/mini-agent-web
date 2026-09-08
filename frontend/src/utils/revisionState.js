/** Read the bounded App Server revision from either protocol naming style. */
export function readStateRevision(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload.stateRevision ?? payload.state_revision;
  if (raw === undefined || raw === null || raw === '') return null;
  const revision = Number(raw);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

/** Client projections may advance or repeat a revision, never move backwards. */
export function shouldApplyStateRevision(currentRevision, nextRevision) {
  if (nextRevision === null || nextRevision === undefined) {
    return currentRevision === null || currentRevision === undefined;
  }
  return (
    currentRevision === null ||
    currentRevision === undefined ||
    nextRevision >= currentRevision
  );
}

/** Read the bounded Gateway runtime generation from a restart notification. */
export function readRuntimeGeneration(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload.runtimeGeneration ?? payload.runtime_generation;
  if (raw === undefined || raw === null || raw === '') return null;
  const generation = Number(raw);
  return Number.isSafeInteger(generation) && generation >= 1 ? generation : null;
}

/** Ignore an out-of-order Gateway restart notification. */
export function shouldApplyRuntimeGeneration(currentGeneration, nextGeneration) {
  if (nextGeneration === null || nextGeneration === undefined) return false;
  return (
    currentGeneration === null ||
    currentGeneration === undefined ||
    nextGeneration > currentGeneration
  );
}
