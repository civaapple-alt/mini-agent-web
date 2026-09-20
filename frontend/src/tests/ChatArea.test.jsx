import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatArea from '../components/ChatArea';

describe('ChatArea turn status', () => {
  it('shows the settled failure reason instead of a generic incomplete label', () => {
    render(
      <ChatArea
        messages={[]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={{
          status: 'failed',
          steps: 2,
          error: 'model request failed: transport error',
        }}
        onQuickPrompt={() => {}}
        onRetryPrompt={() => {}}
      />,
    );

    expect(screen.getByText('本轮执行失败')).toBeDefined();
    expect(screen.getByText(/原因：model request failed: transport error/)).toBeDefined();
    expect(screen.queryByText('本轮未完整结束')).toBeNull();
  });
});

describe('ChatArea delegated child task batch', () => {
  const messages = [{
    id: 'assistant-turn-4',
    role: 'assistant',
    turnId: 'turn-4',
    blocks: [
      {
        type: 'tool',
        id: 'delegate-1',
        name: 'delegate_task',
        args: { child_thread_id: 'child-a', title: 'Trace event ordering', execution_mode: 'parallel' },
        status: 'completed',
      },
      {
        type: 'tool',
        id: 'delegate-2',
        name: 'delegate_task',
        args: { child_thread_id: 'child-b', title: 'Check session replay', execution_mode: 'parallel' },
        status: 'completed',
      },
    ],
  }];

  const queuedTasks = [
    {
      operation_id: 'op-a',
      child_thread_id: 'child-a',
      parent_turn_id: 'turn-4',
      title: 'Trace event ordering',
      execution_mode: 'parallel',
      status: 'queued',
      waiting_reason: '等待并发槽位',
      reports: [{ text: '先检查事件排序', timestamp_ms: 1_700_000_000_100 }],
      lifecycle: [{ status: 'queued', timestamp_ms: 1_700_000_000_000, attempt: 1 }],
      child_session_available: true,
    },
    {
      operation_id: 'op-b',
      child_thread_id: 'child-b',
      parent_turn_id: 'turn-4',
      title: 'Check session replay',
      execution_mode: 'parallel',
      status: 'running',
      lifecycle: [
        { status: 'queued', timestamp_ms: 1_700_000_000_000, attempt: 1 },
        { status: 'running', timestamp_ms: 1_700_000_001_000, attempt: 1 },
      ],
      started_at_ms: 1_700_000_001_000,
      child_session_available: true,
    },
  ];

  const renderArea = (childTasks) => (
    <ChatArea
      messages={messages}
      childTasks={childTasks}
      isGenerating={false}
      pendingApproval={null}
      lastTurnResult={null}
      onQuickPrompt={() => {}}
      onRetryPrompt={() => {}}
    />
  );

  it('renders one ordered batch card with each child name and lifecycle', () => {
    const { container } = render(renderArea(queuedTasks));

    expect(screen.getAllByLabelText('子代理任务批次')).toHaveLength(1);
    expect([...container.querySelectorAll('.delegate-task-heading strong')].map((node) => node.textContent))
      .toEqual(['Trace event ordering', 'Check session replay']);
    expect(screen.getAllByText('已分配').length).toBeGreaterThan(0);
    expect(screen.getByText('已开始')).toBeTruthy();
    expect(screen.getByText('排队中')).toBeTruthy();
    expect(screen.getByText('运行中')).toBeTruthy();
    expect(screen.getByText('等待并发槽位')).toBeTruthy();
    expect(screen.getByText('先检查事件排序')).toBeTruthy();
  });

  it('updates the replayed batch as child lifecycle reaches a terminal state', () => {
    const { rerender } = render(renderArea(queuedTasks));
    const completedTasks = [
      {
        ...queuedTasks[0],
        status: 'completed',
        duration_ms: 2_400,
        started_at_ms: 1_700_000_001_000,
        finished_at_ms: 1_700_000_003_400,
        lifecycle: [
          ...queuedTasks[0].lifecycle,
          { status: 'running', timestamp_ms: 1_700_000_001_000, attempt: 1 },
          { status: 'completed', timestamp_ms: 1_700_000_003_400, attempt: 1 },
        ],
      },
      {
        ...queuedTasks[1],
        status: 'failed',
        duration_ms: 1_800,
        finished_at_ms: 1_700_000_002_800,
        lifecycle: [
          ...queuedTasks[1].lifecycle,
          { status: 'failed', timestamp_ms: 1_700_000_002_800, attempt: 1 },
        ],
      },
    ];
    rerender(renderArea(completedTasks));

    expect(screen.getByText('已完成 · 2.4s')).toBeTruthy();
    expect(screen.getByText('失败 · 1.8s')).toBeTruthy();
    expect(screen.getAllByText('失败').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('子代理任务批次')).toHaveLength(1);
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
  });

  it('keeps a message without a Turn ID from absorbing unrelated child tasks', () => {
    render(
      <ChatArea
        messages={[{
          id: 'legacy-message',
          role: 'assistant',
          blocks: [{
            type: 'tool',
            id: 'delegate-a',
            name: 'delegate_task',
            args: { child_thread_id: 'child-a', title: 'Trace event ordering' },
            status: 'completed',
          }],
        }]}
        childTasks={[
          { child_thread_id: 'child-a', title: 'Trace event ordering', status: 'completed' },
          { child_thread_id: 'child-b', title: 'Unrelated child task', status: 'running' },
        ]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={null}
        onQuickPrompt={() => {}}
        onRetryPrompt={() => {}}
      />,
    );

    expect(screen.getAllByLabelText('子代理任务批次')).toHaveLength(1);
    expect(screen.getByText('Trace event ordering')).toBeTruthy();
    expect(screen.queryByText('Unrelated child task')).toBeNull();
  });
});
