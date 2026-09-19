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

    fireEvent.click(screen.getByRole('button', { name: '打开' }));
    expect(onOpenThread).toHaveBeenCalledWith('child-a', 'memory-card');
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
    expect(container.querySelector('.child-task-meta').textContent).toContain('2.4s');
  });
});
