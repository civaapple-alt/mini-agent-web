import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { api } from '../api';
import useChildTasks from '../hooks/useChildTasks';

vi.mock('../api', () => ({
  api: {
    listChildTasks: vi.fn(),
  },
}));

function ChildTasksProbe() {
  const { children } = useChildTasks('parent-thread', 'memory-card');
  return <div role="status">{children.map((child) => `${child.title}: ${child.status}`).join(', ')}</div>;
}

describe('useChildTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('updates the shared task projection from a parent websocket event and refreshes it', async () => {
    const queued = {
      operation_id: 'child:child-a',
      child_thread_id: 'child-a',
      parent_turn_id: 'turn-2',
      title: 'Trace event ordering',
      status: 'queued',
      lifecycle: [{ status: 'queued', timestamp_ms: 1_700_000_000_000, attempt: 1 }],
    };
    const running = {
      ...queued,
      status: 'running',
      lifecycle: [
        ...queued.lifecycle,
        { status: 'running', timestamp_ms: 1_700_000_001_000, attempt: 1 },
      ],
      started_at_ms: 1_700_000_001_000,
    };
    api.listChildTasks
      .mockResolvedValueOnce({ children: [queued] })
      .mockResolvedValueOnce({ children: [running] });

    render(<ChildTasksProbe />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('queued'));

    window.dispatchEvent(new CustomEvent('mini-agent:child-operation-updated', {
      detail: {
        threadId: 'parent-thread',
        projectId: 'memory-card',
        data: running,
      },
    }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('running'));
    expect(api.listChildTasks).toHaveBeenCalledTimes(2);
  });

  it('reconciles an empty snapshot at a slower interval if an event was missed', async () => {
    vi.useFakeTimers();
    api.listChildTasks
      .mockResolvedValueOnce({ children: [] })
      .mockResolvedValueOnce({ children: [{
        child_thread_id: 'child-late',
        title: 'Recovered delegated task',
        status: 'running',
      }] });

    render(<ChildTasksProbe />);
    await act(async () => { await Promise.resolve(); });
    expect(api.listChildTasks).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    expect(api.listChildTasks).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status').textContent).toContain('Recovered delegated task: running');
  });
});
