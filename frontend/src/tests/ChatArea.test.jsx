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

  it('hides a previous incomplete result while a steer continuation is active', () => {
    const baseProps = {
      messages: [{
        id: 'steer-1',
        role: 'user',
        text: '继续核对',
        isSteer: true,
        steerTurnId: 'turn-1',
      }],
      pendingApproval: null,
      lastTurnResult: {
        status: 'step_limit',
        steps: 6,
        turnId: 'turn-1',
      },
      onQuickPrompt: () => {},
      onRetryPrompt: () => {},
    };
    const { rerender } = render(<ChatArea {...baseProps} isGenerating />);

    expect(screen.queryByText('本轮达到运行步数上限')).toBeNull();

    rerender(<ChatArea {...baseProps} isGenerating={false} />);
    expect(screen.getByText('本轮达到运行步数上限')).toBeTruthy();
    expect(screen.getByText(/已执行 6 步/)).toBeTruthy();
  });

  it('hides an incomplete result while runtime status says the Turn is active', () => {
    render(
      <ChatArea
        messages={[]}
        isGenerating={false}
        pendingApproval={null}
        statusModel={{ lifecycle: 'running', process: { turnActive: true } }}
        lastTurnResult={{ status: 'failed', turnId: 'turn-2', error: 'old failure' }}
        onQuickPrompt={() => {}}
        onRetryPrompt={() => {}}
      />,
    );

    expect(screen.queryByText('本轮执行失败')).toBeNull();
  });

  it('does not show the incomplete banner for an unknown or steer-transition status', () => {
    const { rerender } = render(
      <ChatArea
        messages={[]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={{ status: 'unknown' }}
      />,
    );

    expect(screen.queryByText('本轮状态未知')).toBeNull();
    rerender(
      <ChatArea
        messages={[]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={{ status: 'steered' }}
      />,
    );
    expect(screen.queryByText('本轮未完整结束')).toBeNull();
  });
});

describe('ChatArea restored assistant replies', () => {
  it('shows reply actions only on the last assistant segment of each Turn', () => {
    const { container } = render(
      <ChatArea
        messages={[
          {
            id: 'turn-two-answer',
            role: 'assistant',
            turnId: 'turn-2',
            blocks: [{ type: 'text', id: 'answer-2', content: 'Earlier answer' }],
          },
          {
            id: 'turn-five-progress',
            role: 'assistant',
            turnId: 'turn-5',
            blocks: [{ type: 'text', id: 'progress-5', content: 'Now the new section at the end of the file.' }],
          },
          {
            id: 'turn-five-follow-up',
            role: 'assistant',
            turnId: 'turn-5',
            blocks: [{ type: 'tool', id: 'tool-5', name: 'apply_patch', status: 'completed' }],
          },
          {
            id: 'turn-five-answer',
            role: 'assistant',
            turnId: 'turn-5',
            blocks: [{ type: 'text', id: 'answer-5', content: 'The work is complete.' }],
          },
        ]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={null}
        onQuickPrompt={() => {}}
        onRetryPrompt={() => {}}
      />,
    );

    const footerMessageIds = [...container.querySelectorAll('.assistant-footer')]
      .map((footer) => footer.closest('.message-row')?.getAttribute('data-message-id'));
    expect(footerMessageIds).toEqual(['turn-two-answer', 'turn-five-answer']);
  });

  it('keeps the live execution segment expanded until the next segment begins', () => {
    const { container, rerender } = render(
      <ChatArea
        messages={[{
          id: 'assistant-live',
          role: 'assistant',
          turnId: 'turn-live',
          blocks: [
            { type: 'thinking', id: 'thinking-one', content: 'previous reasoning' },
            { type: 'tool', id: 'tool-one', name: 'read_file', status: 'completed' },
          ],
        }]}
        statusModel={{ scope: { turnId: 'turn-live' }, lifecycle: 'running' }}
        isGenerating
        pendingApproval={null}
        lastTurnResult={null}
      />,
    );

    expect(container.querySelector('.thinking-body')?.textContent).toContain('previous reasoning');
    expect(container.querySelector('.assistant-activity-group')).toBeNull();

    rerender(
      <ChatArea
        messages={[{
          id: 'assistant-live',
          role: 'assistant',
          turnId: 'turn-live',
          blocks: [
            { type: 'thinking', id: 'thinking-one', content: 'previous reasoning' },
            { type: 'tool', id: 'tool-one', name: 'read_file', status: 'completed' },
            { type: 'thinking', id: 'thinking-two', content: 'current reasoning' },
          ],
        }]}
        statusModel={{ scope: { turnId: 'turn-live' }, lifecycle: 'running' }}
        isGenerating
        pendingApproval={null}
        lastTurnResult={null}
      />,
    );

    expect(screen.getByRole('button', { name: /已完成 2 项活动/ })).toBeTruthy();
    expect(container.querySelectorAll('.thinking-body')).toHaveLength(1);
    expect(container.querySelector('.thinking-body')?.textContent).toContain('current reasoning');
    expect(screen.queryByText('previous reasoning')).toBeNull();
  });

  it('restores the final settled segment expanded while earlier work stays summarized', () => {
    const { container } = render(
      <ChatArea
        messages={[{
          id: 'assistant-restored',
          role: 'assistant',
          turnId: 'turn-restored',
          blocks: [
            { type: 'thinking', id: 'restored-thinking-one', content: 'earlier reasoning' },
            { type: 'tool', id: 'restored-tool-one', name: 'read_file', status: 'completed' },
            { type: 'thinking', id: 'restored-thinking-two', content: 'final segment reasoning' },
            { type: 'tool', id: 'restored-tool-two', name: 'apply_patch', status: 'completed' },
            { type: 'text', id: 'restored-final', content: 'final response' },
          ],
        }]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={null}
      />,
    );

    expect(screen.getByRole('button', { name: /已完成 2 项活动/ })).toBeTruthy();
    expect(container.querySelectorAll('.thinking-body')).toHaveLength(1);
    expect(container.querySelector('.thinking-body')?.textContent)
      .toContain('final segment reasoning');
    expect(screen.queryByText('earlier reasoning')).toBeNull();
    expect(screen.getByText('final response')).toBeTruthy();
  });

  it('compresses earlier restored assistant segments in a Turn and preserves its last segment', () => {
    const { container } = render(
      <ChatArea
        messages={[
          { id: 'turn-input', role: 'user', turnId: 'turn-segments', text: 'inspect and update' },
          {
            id: 'segment-one',
            role: 'assistant',
            turnId: 'turn-segments',
            blocks: [
              { type: 'thinking', id: 'segment-one-thinking', content: 'earlier segment' },
              { type: 'tool', id: 'segment-one-tool', name: 'read_file', status: 'completed' },
            ],
          },
          {
            id: 'segment-two',
            role: 'assistant',
            turnId: 'turn-segments',
            blocks: [
              { type: 'thinking', id: 'segment-two-thinking', content: 'last segment' },
              { type: 'tool', id: 'segment-two-tool', name: 'apply_patch', status: 'completed' },
              { type: 'text', id: 'segment-two-answer', content: 'final answer' },
            ],
          },
        ]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={null}
      />,
    );

    expect(container.querySelectorAll('.assistant-activity-group-summary')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /已完成 2 项活动/ })).toBeTruthy();
    expect(container.querySelectorAll('.thinking-body')).toHaveLength(1);
    expect(container.querySelector('.thinking-body')?.textContent).toContain('last segment');
    expect(screen.queryByText('earlier segment')).toBeNull();
    expect(container.querySelector('[data-message-id="segment-two"]')?.textContent)
      .toContain('final answer');
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
