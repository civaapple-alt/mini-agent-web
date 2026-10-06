import assert from 'node:assert/strict';
import test from 'node:test';
import {
  partitionApprovalsByThread,
  projectOtherThreadApprovalEvent,
} from '../utils/approvalScopes.js';

test('keeps the selected Thread approvals separate from other Threads in the Project', () => {
    const approvals = [
      { requestId: 'parent-approval', data: { projectId: 'project-a', threadId: 'parent' } },
      { requestId: 'child-approval', data: { projectId: 'project-a', threadId: 'child' } },
      { requestId: 'foreign-project', data: { projectId: 'project-b', threadId: 'other' } },
    ];

    assert.deepEqual(partitionApprovalsByThread(approvals, 'parent', 'project-a'), {
      currentThread: [approvals[0]],
      otherThreads: [approvals[1]],
    });
});

test('keeps legacy unscoped approvals visible to the selected Thread', () => {
    const approval = { requestId: 'legacy-approval', data: { actionSummary: 'shell command' } };
    assert.deepEqual(partitionApprovalsByThread([approval], 'parent', 'project-a'), {
      currentThread: [approval],
      otherThreads: [],
    });
});

test('projects same-Project child approval notifications before active-Thread filtering', () => {
    assert.deepEqual(projectOtherThreadApprovalEvent({
      type: 'approval_request',
      requestId: 'child-request',
      projectId: 'project-a',
      threadId: 'child',
      data: { callId: 'child-call', actionSummary: 'shell command' },
    }, 'parent', 'project-a'), {
      kind: 'requested',
      requestId: 'child-request',
      approval: {
        callId: 'child-call',
        actionSummary: 'shell command',
        projectId: 'project-a',
        threadId: 'child',
        turnId: null,
      },
    });
    assert.equal(projectOtherThreadApprovalEvent({
      type: 'approval_request',
      requestId: 'other-project',
      projectId: 'project-b',
      threadId: 'child',
    }, 'parent', 'project-a'), null);
    assert.equal(projectOtherThreadApprovalEvent({
      type: 'approval_request',
      requestId: 'parent-request',
      projectId: 'project-a',
      threadId: 'parent',
    }, 'parent', 'project-a'), null);
});
