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
            execution_mode: 'parallel',
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

  it('puts active work first and shows current report and waiting reason', () => {
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
      .map((node) => node.textContent)).toEqual(['Waiting task', 'Active task']);
    expect(screen.getByText('等待：')).toBeTruthy();
    expect(screen.getByText('等待上一顺序步骤成功')).toBeTruthy();
    expect(screen.getByText('已完成文件盘点')).toBeTruthy();
    expect(screen.getByRole('button', { name: '显示已结束任务（1）' })).toBeTruthy();
    expect(screen.queryByText('Finished task')).toBeNull();
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
