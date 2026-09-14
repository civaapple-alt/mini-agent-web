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
      screen.getByText('当前轮次正在停止，审批已失效；不会继续执行此工具'),
    ).toBeDefined();

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    fireEvent.click(buttons[0]);
    expect(onRespondApproval).not.toHaveBeenCalled();
  });
});
