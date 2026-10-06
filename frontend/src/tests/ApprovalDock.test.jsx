import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ApprovalDock from '../components/input/ApprovalDock';

describe('ApprovalDock', () => {
  it('locks every approval control while the Turn is stopping', () => {
    const onRespondApproval = vi.fn();

    render(
      <ApprovalDock
        pendingApproval={{
          requestId: 'approval-stop-1',
          data: {
            actionSummary: 'shell command `npm test`',
            allowedGrantScopes: ['once', 'session', 'project'],
          },
        }}
        isInterrupting
        onRespondApproval={onRespondApproval}
      />,
    );

    expect(screen.getByText('审批已锁定')).toBeDefined();
    expect(
      screen.getByText('当前 Turn 正在停止，等待运行时确认后再处理审批'),
    ).toBeDefined();

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    fireEvent.click(buttons[0]);
    expect(onRespondApproval).not.toHaveBeenCalled();
  });

  it('sends the stable tool call id when approving one item in a queue', () => {
    const onRespondApproval = vi.fn();

    render(
      <ApprovalDock
        pendingApproval={{
          requestId: 'approval-reused',
          data: {
            actionSummary: 'shell command `pwd`',
            callId: 'call-second',
            allowedGrantScopes: ['once'],
          },
        }}
        pendingApprovalCount={2}
        onRespondApproval={onRespondApproval}
      />,
    );

    expect(screen.getByText('待审批 2 项 · ID: approval-reused')).toBeDefined();
    fireEvent.click(screen.getByText('允许本次 (Once)'));
    expect(onRespondApproval).toHaveBeenCalledWith(
      'approval-reused',
      'approve',
      '',
      'once',
      'call-second',
    );
  });

  it('keeps approval controls disabled until the connection state is confirmed', () => {
    const onRespondApproval = vi.fn();

    render(
      <ApprovalDock
        pendingApproval={{
          requestId: 'approval-offline',
          data: { callId: 'call-offline', actionSummary: '写入文件', allowedGrantScopes: ['once'] },
        }}
        actionsDisabled
        blockedMessage="连接恢复后才能提交审批"
        onRespondApproval={onRespondApproval}
      />,
    );

    expect(screen.getByText('连接恢复后才能提交审批')).toBeDefined();
    const approve = screen.getByRole('button', { name: '允许本次 (Once)' });
    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    expect(onRespondApproval).not.toHaveBeenCalled();
  });

  it('shows the patch change kind and target files before approval', () => {
    render(
      <ApprovalDock
        pendingApproval={{
          requestId: 'approval-patch-1',
          data: {
            actionSummary: 'apply_patch · 修改 1 个文件 · 删除 1 个文件',
            pathScope: {
              kind: 'project',
              paths: ['README.md', 'docs/_probe.md'],
            },
          },
        }}
        onRespondApproval={() => {}}
      />,
    );

    expect(screen.getByText(/删除 1 个文件/)).toBeDefined();
    expect(screen.getByText('涉及文件 2 个')).toBeDefined();
    fireEvent.click(screen.getByText('涉及文件 2 个'));
    expect(screen.getByText('docs/_probe.md')).toBeDefined();
  });

  it('labels a pending approval from a child Thread', () => {
    render(
      <ApprovalDock
        currentThreadId="parent-thread"
        pendingApproval={{
          requestId: 'child-approval',
          data: {
            threadId: 'child-thread',
            actionSummary: 'shell command `python3 make_aligned.py`',
          },
        }}
        onRespondApproval={() => {}}
      />,
    );

    expect(screen.getByText(/来自子会话/)).toBeDefined();
    expect(screen.getByText('child-thread')).toBeDefined();
  });
});
