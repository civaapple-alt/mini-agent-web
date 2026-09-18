function approvalDataOf(pendingApproval) {
  return pendingApproval?.data && typeof pendingApproval.data === 'object'
    ? pendingApproval.data
    : {};
}

/**
 * Normalize bounded approval metadata for the UI. The server remains the
 * authority for the action summary; this helper only selects and caps fields.
 */
export function getApprovalObservation(pendingApproval) {
  const rawData = pendingApproval?.data;
  const data = approvalDataOf(pendingApproval);
  const actionSummary = data.actionSummary || data.action_summary
    || (typeof rawData === 'string' ? rawData : null);
  const pathScope = data.pathScope || data.path_scope || {};
  const targetPaths = Array.isArray(pathScope.paths)
    ? pathScope.paths.filter((path) => typeof path === 'string' && path.trim()).slice(0, 32)
    : [];
  return {
    actionSummary: actionSummary || JSON.stringify(data, null, 2),
    targetPaths,
    pathKind: pathScope.kind || null,
    hasDestructiveChange: /(?:删除|delete|remove|destroy)/i.test(actionSummary || ''),
  };
}
