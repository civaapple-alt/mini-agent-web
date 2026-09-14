import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import StatusRail from '../components/StatusRail';

const baseStatus = {
  scope: { projectId: 'project-a', threadId: 'thread-1', turnId: null },
  connection: 'online',
  lifecycle: 'idle',
  label: '空闲',
  summary: '空闲',
  nextAction: null,
  phase: 'idle',
  runtime: { checkpointSeq: null, operationId: null, error: null, lastWorkflowEvent: null },
  approval: null,
  workflow: { planActive: false, planReviewPending: false, goalStatus: null },
  executionSettings: {
    accessScope: 'project',
    policy: 'interactive',
    continuationMode: 'manual',
    summary: '项目范围 · 交互批准 · 手动推进',
  },
  process: { turnActive: false, processOnline: true, processLabel: '待命' },
  sessionReadOnly: false,
};

describe('StatusRail', () => {
  it('shows scope, connection and execution summary in one status row', () => {
    render(<StatusRail status={baseStatus} onOpenDetails={vi.fn()} />);

    expect(screen.getByRole('status', { name: '运行状态' })).toBeDefined();
    expect(screen.getByText('project-a / thread-1')).toBeDefined();
    expect(screen.getByText('项目范围 · 交互批准 · 手动推进')).toBeDefined();
    expect(screen.getByText('已连接')).toBeDefined();
  });

  it('moves execution controls into the settings popover', () => {
    const onChangeExecution = vi.fn();
    const onChangeContinuation = vi.fn();
    render(
      <StatusRail
        status={baseStatus}
        onOpenDetails={vi.fn()}
        onChangeExecution={onChangeExecution}
        onChangeContinuation={onChangeContinuation}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /项目范围.*交互批准.*手动推进/ }));
    expect(screen.getByRole('dialog', { name: '运行设置' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '自动低风险' }));
    expect(onChangeExecution).toHaveBeenCalledWith('project', 'automatic');
  });

  it('keeps Plan review actions visible without adding another top bar', () => {
    render(
      <StatusRail
        status={{
          ...baseStatus,
          lifecycle: 'plan_review',
          label: '等待确认',
          summary: '规划已完成，请选择继续规划或开始实施',
          workflow: { planActive: true, planReviewPending: true, goalStatus: null },
        }}
        onOpenDetails={vi.fn()}
        onContinuePlanning={vi.fn()}
        onStartImplementation={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '继续规划' })).toBeDefined();
    expect(screen.getByRole('button', { name: '开始实施' })).toBeDefined();
  });

  it('explains why settings are locked during a Turn', () => {
    render(
      <StatusRail
        status={{
          ...baseStatus,
          lifecycle: 'approval',
          label: '等待审批',
          summary: '敏感操作已暂停，等待人工授权',
          process: { turnActive: true, processOnline: true, processLabel: '运行中' },
          approval: { requestId: 'req-1', state: 'pending' },
        }}
        onOpenDetails={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /项目范围.*交互批准.*手动推进/ }));
    expect(screen.getByText('当前 Turn 结束后可修改运行设置')).toBeDefined();
    expect(screen.getByRole('button', { name: '自动低风险' }).disabled).toBe(true);
  });
});
