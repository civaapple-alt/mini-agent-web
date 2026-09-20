import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ChildTasksPane from '../components/ChildTasksPane';

describe('ChildTasksPane', () => {
  it('shows child lifecycle and diagnostics but does not open a child without a Session', () => {
    render(
      <ChildTasksPane
        projectId="memory-card"
        onOpenThread={vi.fn()}
        children={[
          {
            operation_id: 'operation-failed',
            child_thread_id: 'child-missing',
            title: 'Frontend size estimate',
            status: 'failed',
            child_session_available: false,
            operation_error: 'child Session creation failed',
            lifecycle: [
              { status: 'queued', timestamp_ms: 1_700_000_000_000, attempt: 1 },
              { status: 'failed', timestamp_ms: 1_700_000_002_000, attempt: 1 },
            ],
          },
        ]}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('Frontend size estimate')).toBeTruthy();
    expect(screen.getByText('child Session creation failed')).toBeTruthy();
    expect(screen.getByText('模式未知')).toBeTruthy();
    expect(screen.getByText('已分配')).toBeTruthy();
    expect(screen.getAllByText('失败').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '打开' })).toBeNull();
  });

  it('opens a child Session when the projection says it exists', () => {
    const onOpenThread = vi.fn();
    const { container } = render(
      <ChildTasksPane
        projectId="memory-card"
        onOpenThread={onOpenThread}
        children={[
          {
            operation_id: 'operation-a',
            child_thread_id: 'child-a',
            title: 'Check App Server events',
            status: 'completed',
            execution_mode: 'parallel',
            child_session_available: true,
            duration_ms: 2_400,
            lifecycle: [
              { status: 'queued', timestamp_ms: 1_700_000_000_000, attempt: 1 },
              { status: 'running', timestamp_ms: 1_700_000_001_000, attempt: 1 },
              { status: 'completed', timestamp_ms: 1_700_000_002_400, attempt: 1 },
            ],
          },
        ]}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '显示已结束任务（1）' }));
    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    expect(onOpenThread).toHaveBeenCalledWith('child-a', 'memory-card');
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
    expect(container.querySelector('.child-task-meta').textContent).toContain('2.4s');
  });

  it('prioritizes running work over queued work and shows the current report', () => {
    const { container } = render(
      <ChildTasksPane
        children={[
          { operation_id: 'done', title: 'Finished task', status: 'completed' },
          {
            operation_id: 'queued',
            title: 'Waiting task',
            status: 'queued',
            waiting_reason: '等待上一顺序步骤成功',
            reports: [{
              cursor: 7,
              report_id: 'report-7',
              attempt: 1,
              report: '已完成文件盘点',
              timestamp_ms: 1_700_000_000_000,
            }],
            next_cursor: 7,
          },
          { operation_id: 'running', title: 'Active task', status: 'running' },
        ]}
        loading={false}
        error={null}
      />,
    );

    expect([...container.querySelectorAll('.child-task-row .child-task-main strong')]
      .map((node) => node.textContent)).toEqual(['Active task', 'Waiting task']);
    expect(screen.getByText('等待：')).toBeTruthy();
    expect(screen.getByText('等待上一顺序步骤成功')).toBeTruthy();
    expect(screen.getByText('已完成文件盘点')).toBeTruthy();
    expect(screen.getByRole('button', { name: '显示已结束任务（1）' })).toBeTruthy();
    expect(screen.queryByText('Finished task')).toBeNull();
  });

  it('groups retry stages, shows sequence position, and prioritizes recovery and failures', () => {
    const { container } = render(
      <ChildTasksPane
        children={[
          {
            operation_id: 'queued-step',
            title: 'Queued step',
            status: 'queued',
            execution_mode: 'sequential',
            operation_group_id: 'review-group',
            group_sequence: 1,
          },
          {
            operation_id: 'retrying',
            title: 'Active retry',
            status: 'running',
            phase: 'tool',
            execution_mode: 'sequential',
            operation_group_id: 'review-group',
            group_sequence: 0,
            operation_attempt: 2,
            lifecycle: [
              { status: 'queued', attempt: 1 },
              { status: 'failed', attempt: 1 },
              { status: 'queued', attempt: 2 },
              { status: 'running', attempt: 2 },
            ],
            reports: [{ attempt: 2, report: '正在修复评审指出的问题' }],
          },
          { operation_id: 'failed', title: 'Failed task', status: 'failed' },
          {
            operation_id: 'not-started',
            title: 'Not started task',
            status: 'not_started',
            operation_error: 'No turn ID returned',
          },
          {
            operation_id: 'recovering',
            title: 'Recovery task',
            status: 'running',
            recovery_required: true,
          },
        ]}
        loading={false}
        error={null}
      />,
    );

    expect([...container.querySelectorAll('.child-task-row .child-task-main strong')]
      .map((node) => node.textContent)).toEqual([
      'Failed task',
      'Not started task',
      'Recovery task',
      'Active retry',
      'Queued step',
    ]);
    expect(container.querySelector('.child-task-count').textContent.replace(/\s+/g, ' ').trim())
      .toBe('运行 1 · 排队 1 · 待处理 3 · 共 5');
    expect(container.querySelector('.child-task-status.not_started')?.textContent).toBe('未开始');
    expect(screen.getByText('No turn ID returned')).toBeTruthy();

    const retry = [...container.querySelectorAll('.child-task-row')]
      .find((row) => row.textContent.includes('Active retry'));
    expect(retry.textContent).toContain('第 2 轮');
    expect(retry.textContent).toContain('第 1/2 步');
    expect(retry.textContent).toContain('执行工具');
    expect(retry.textContent).toContain('正在修复评审指出的问题');
    expect(retry.querySelectorAll('.child-task-attempt')).toHaveLength(2);
    expect(screen.getByText(/需要重新连接/)).toBeTruthy();
  });

  it('labels initial, retry, and follow-up rounds from persisted attempt kinds', () => {
    const { container } = render(
      <ChildTasksPane
        children={[{
          operation_id: 'multi-round',
          child_thread_id: 'child-rounds',
          title: 'Review and revise output',
          status: 'running',
          operation_attempt: 3,
          attempt_kind: 'follow_up',
          lifecycle: [
            { status: 'queued', attempt: 1, attempt_kind: 'initial' },
            { status: 'completed', attempt: 1, attempt_kind: 'initial' },
            { status: 'queued', attempt: 2, attempt_kind: 'retry' },
            { status: 'failed', attempt: 2, attempt_kind: 'retry' },
            { status: 'queued', attempt: 3, attempt_kind: 'follow_up' },
            { status: 'running', attempt: 3, attempt_kind: 'follow_up' },
          ],
          reports: [{ attempt: 3, report: '正在处理评审意见' }],
        }]}
        loading={false}
        error={null}
      />,
    );

    const card = container.querySelector('.child-task-row');
    expect(card.querySelectorAll('.child-task-attempt')).toHaveLength(3);
    expect(card.textContent).toContain('初始执行');
    expect(card.textContent).toContain('重试 · 第 2 轮');
    expect(card.textContent).toContain('后续委托 · 第 3 轮');
    expect(card.textContent).toContain('后续委托 · 第 3 轮进展：');
  });

  it('pages completed tasks in groups and can collapse the history again', () => {
    const finished = Array.from({ length: 7 }, (_, index) => ({
      operation_id: `done-${index + 1}`,
      title: `Finished ${index + 1}`,
      status: 'completed',
    }));
    render(<ChildTasksPane children={finished} loading={false} error={null} />);

    fireEvent.click(screen.getByRole('button', { name: '显示已结束任务（7）' }));
    expect(screen.getByText('Finished 1')).toBeTruthy();
    expect(screen.getByText('Finished 5')).toBeTruthy();
    expect(screen.queryByText('Finished 6')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '显示更多已结束任务（剩余 2）' }));
    expect(screen.getByText('Finished 7')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '收起已结束任务' }));
    expect(screen.queryByText('Finished 1')).toBeNull();
  });
});
