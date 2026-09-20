// Manual fold choices live only for the current page lifetime. Runtime defaults
// are always derived from the persisted block state, so a reload is stable.
const manualExpansionById = new Map();

export function getManualExpansion(id) {
  return id ? manualExpansionById.get(id) : undefined;
}

export function setManualExpansion(id, expanded) {
  if (id) manualExpansionById.set(id, Boolean(expanded));
}
