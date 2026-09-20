import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ChatArea from '../components/ChatArea';
import { collectInputMessages } from '../utils/inputTrace';
import { aggregateStreamEvent } from '../utils/messageState';
import {
  buildTurnHistoryEntries,
  groupSettledAssistantBlocks,
} from '../utils/turnHistory';

const messages = [
  { id: 'user-1', role: 'user', text: '检查仓库结构', turnId: 'turn-1' },
  {
    id: 'assistant-1',
    role: 'assistant',
    turnId: 'turn-1',
    blocks: [
      { type: 'thinking', id: 'thinking-1', content: '读取上下文', isStreaming: false },
      { type: 'tool', id: 'tool-1', name: 'shell', status: 'completed', output: 'ok' },
      { type: 'text', content: '仓库结构已检查。' },
    ],
  },
];

describe('Turn history projection', () => {
  it('keeps source, order, current state, and reliable metrics in one projection', () => {
    const entries = buildTurnHistoryEntries({
      messages: [
        ...messages,
        { id: 'user-2', role: 'user', text: '继续更新提案', turnId: 'turn-2', isSteer: true },
      ],
      statusModel: {
        scope: { turnId: 'turn-1' },
        lifecycle: 'running',
        nextAction: null,
      },
      scope: { threadId: 'thread-1', projectId: 'project-1' },
    });

    expect(entries.map((entry) => entry.summary)).toEqual(['检查仓库结构', '继续更新提案']);
    expect(entries[0]).toMatchObject({
      turnId: 'turn-1',
      source: 'user',
      state: 'running',
      isCurrent: true,
      metrics: { toolCount: 1, shellCount: 1, thinkingCount: 1 },
    });
    expect(entries[1]).toMatchObject({ source: 'steer', state: 'unknown', isCurrent: false });
  });

  it('does not infer a completed historical Turn from assistant content', () => {
    const [entry] = buildTurnHistoryEntries({
      messages,
      scope: { threadId: 'thread-1' },
    });
    expect(entry.state).toBe('unknown');
    expect(entry.stateLabel).toBe('历史');
  });

  it('groups only adjacent successful settled activity and keeps boundaries visible', () => {
    const grouped = groupSettledAssistantBlocks([
      { type: 'thinking', id: 'thinking-1', content: 'done', isStreaming: false },
      { type: 'tool', id: 'tool-1', name: 'shell', status: 'completed' },
      { type: 'tool', id: 'tool-running', name: 'shell', status: 'running' },
      { type: 'tool', id: 'tool-queued', name: 'shell', status: 'queued' },
      { type: 'tool', id: 'tool-approval', name: 'shell', status: 'completed', approval: { state: 'approved' } },
      { type: 'tool', id: 'tool-delegate', name: 'delegate_task', status: 'completed' },
      { type: 'tool', id: 'tool-2', name: 'shell', status: 'failed', error: 'boom' },
      { type: 'text', content: 'partial' },
    ]);
    expect(grouped[0].type).toBe('activityGroup');
    expect(grouped[0].items).toHaveLength(2);
    expect(grouped.slice(1).map((block) => block.id || block.type)).toEqual([
      'tool-running',
      'tool-queued',
      'tool-approval',
      'tool-delegate',
      'tool-2',
      'text',
    ]);
  });

  it('keeps retryable, unknown, failure, and approval tool outcomes out of success summaries', () => {
    const grouped = groupSettledAssistantBlocks([
      { type: 'tool', id: 'tool-explicit-success', name: 'shell', status: 'completed', outcome: 'completed' },
      { type: 'tool', id: 'tool-retryable', name: 'shell', status: 'completed', outcome: 'retryable' },
      { type: 'tool', id: 'tool-unknown', name: 'shell', status: 'completed', outcome: 'server_added_state' },
      { type: 'tool', id: 'tool-failed', name: 'shell', status: 'completed', outcome: 'failed' },
      { type: 'tool', id: 'tool-approval', name: 'shell', status: 'completed', outcome: 'needs_approval' },
      { type: 'tool', id: 'tool-denied', name: 'shell', status: 'completed', approval: { state: 'denied' } },
      { type: 'tool', id: 'tool-no-outcome', name: 'shell', status: 'completed' },
    ]);

    expect(grouped.map((block) => block.id || block.type)).toEqual([
      'activity_tool-explicit-success',
      'tool-retryable',
      'tool-unknown',
      'tool-failed',
      'tool-approval',
      'tool-denied',
      'activity_tool-no-outcome',
    ]);
    expect(grouped[0].items.map((block) => block.id)).toEqual(['tool-explicit-success']);
    expect(grouped.at(-1).items.map((block) => block.id)).toEqual(['tool-no-outcome']);
  });

  it('keeps child-wakeup turns out of user bubbles and labels their source in the Turn rail', () => {
    const messages = [
      {
        id: 'turn_wakeup-1',
        role: 'assistant',
        turnId: 'wakeup-1',
        turnSource: 'child_wakeup',
        text: '',
        blocks: [],
      },
      { id: 'wakeup-input', role: 'user', turnId: 'wakeup-1', text: 'internal child update prompt' },
      { id: 'normal-input', role: 'user', turnId: 'user-1', text: '普通用户输入' },
    ];
    const threadItems = [
      { turnId: 'wakeup-1', turnSource: 'child_wakeup', item: { type: 'turnStarted' } },
      { turnId: 'wakeup-1', item: { type: 'userMessage', id: 'wakeup-input', text: 'internal child update prompt' } },
      { turnId: 'user-1', item: { type: 'userMessage', id: 'normal-input', text: '普通用户输入' } },
    ];

    expect(collectInputMessages(messages, threadItems).map((message) => message.text))
      .toEqual(['普通用户输入']);
    const turnEntries = buildTurnHistoryEntries({ messages, threadItems });
    expect(turnEntries.map(({ turnId, source, summary }) => ({ turnId, source, summary })))
      .toEqual([
        { turnId: 'wakeup-1', source: 'child_wakeup', summary: '子代理更新' },
        { turnId: 'user-1', source: 'user', summary: '普通用户输入' },
      ]);

    render(
      <ChatArea
        messages={messages}
        threadItems={threadItems}
        statusModel={null}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={null}
      />,
    );
    expect(screen.queryByText('internal child update prompt')).toBeNull();
    expect(screen.getByText('子代理更新')).toBeDefined();
    expect(screen.getAllByText('普通用户输入')).toHaveLength(2);
  });

  it('stores a structured child-wakeup source on the live Turn placeholder', () => {
    const messages = aggregateStreamEvent([], {
      type: 'event',
      turnId: 'wakeup-2',
      turnSource: 'child_wakeup',
      event: { type: 'turn_started' },
    });
    expect(messages[0]).toMatchObject({ turnId: 'wakeup-2', turnSource: 'child_wakeup' });
  });
});

describe('ChatArea direction cues', () => {
  it('jumps new activity to the latest assistant message in the current Turn', () => {
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    );
    const calls = [];
    HTMLElement.prototype.scrollIntoView = vi.fn(function scrollIntoView(options) {
      calls.push({ messageId: this.getAttribute('data-message-id'), options });
    });

    try {
      const props = {
        messages: [
          { id: 'input-current', role: 'user', text: 'current prompt', turnId: 'turn-current' },
          { id: 'assistant-first', role: 'assistant', text: 'first segment', turnId: 'turn-current' },
        ],
        statusModel: { scope: { turnId: 'turn-current' }, lifecycle: 'running', summary: 'first' },
        isGenerating: true,
        pendingApproval: null,
        lastTurnResult: null,
      };
      const { container, rerender } = render(<ChatArea {...props} />);
      const scrollContainer = container.querySelector('.chat-area');
      Object.defineProperty(scrollContainer, 'scrollHeight', { configurable: true, value: 1200 });
      Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 500 });
      scrollContainer.scrollTop = 0;
      fireEvent.scroll(scrollContainer);

      rerender(
        <ChatArea
          {...props}
          messages={[
            ...props.messages,
            { id: 'assistant-latest', role: 'assistant', text: 'latest activity', turnId: 'turn-current' },
          ]}
          statusModel={{ ...props.statusModel, summary: 'updated' }}
        />,
      );
      calls.length = 0;
      fireEvent.click(screen.getByText('有新活动 · 查看当前 Turn'));

      expect(calls).toEqual([{
        messageId: 'assistant-latest',
        options: expect.objectContaining({ block: 'end' }),
      }]);
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
      } else {
        delete HTMLElement.prototype.scrollIntoView;
      }
    }
  });

  it('falls back to the current Turn input when no assistant activity exists', () => {
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    );
    const calls = [];
    HTMLElement.prototype.scrollIntoView = vi.fn(function scrollIntoView(options) {
      calls.push({ messageId: this.getAttribute('data-message-id'), options });
    });

    try {
      const props = {
        messages: [{ id: 'input-only', role: 'user', text: 'waiting for work', turnId: 'turn-current' }],
        statusModel: { scope: { turnId: 'turn-current' }, lifecycle: 'running', summary: 'first' },
        isGenerating: true,
        pendingApproval: null,
        lastTurnResult: null,
      };
      const { container, rerender } = render(<ChatArea {...props} />);
      const scrollContainer = container.querySelector('.chat-area');
      Object.defineProperty(scrollContainer, 'scrollHeight', { configurable: true, value: 1200 });
      Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 500 });
      scrollContainer.scrollTop = 0;
      fireEvent.scroll(scrollContainer);
      rerender(<ChatArea {...props} statusModel={{ ...props.statusModel, summary: 'updated' }} />);
      calls.length = 0;

      fireEvent.click(screen.getByText('有新活动 · 查看当前 Turn'));

      expect(calls).toEqual([{
        messageId: 'input-only',
        options: expect.objectContaining({ block: 'center' }),
      }]);
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
      } else {
        delete HTMLElement.prototype.scrollIntoView;
      }
    }
  });

  it('anchors a projected older input before newer checkpoint content', () => {
    const { container } = render(
      <ChatArea
        messages={[
          { id: 'turn-11-user', role: 'user', text: '不做剪贴板监听', turnId: 'turn-11' },
          { id: 'turn-11-assistant', role: 'assistant', turnId: 'turn-11', text: 'answer' },
        ]}
        threadItems={[
          { turnId: 'turn-9', item: { type: 'userMessage', id: 'turn-9-user', text: 'recall 继续' } },
          { turnId: 'turn-11', item: { type: 'userMessage', id: 'turn-11-user', text: '不做剪贴板监听' } },
        ]}
        statusModel={null}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={null}
        traceScope={{ threadId: 'thread-1', projectId: 'project-1' }}
      />,
    );

    expect(Array.from(container.querySelectorAll('.message-row')).map((node) => (
      node.getAttribute('data-turn-id')
    ))).toEqual(['turn-9', 'turn-11', 'turn-11']);
  });

  it('renders a persisted steer between assistant execution segments in the same Turn', () => {
    const { container } = render(
      <ChatArea
        messages={[
          { id: 'input-1', role: 'user', text: 'initial prompt', turnId: 'turn-steer', historyOrder: 0 },
          {
            id: 'assistant-a', role: 'assistant', turnId: 'turn-steer', historyOrder: 1,
            blocks: [{ type: 'text', id: 'answer-a', content: 'before steer' }],
          },
          {
            id: 'assistant-b', role: 'assistant', turnId: 'turn-steer', historyOrder: 4,
            blocks: [{ type: 'text', id: 'answer-b', content: 'after steer' }],
          },
        ]}
        threadItems={[
          { turnId: 'turn-steer', historyOrder: 0, item: { type: 'userMessage', id: 'input-1', text: 'initial prompt' } },
          { turnId: 'turn-steer', historyOrder: 3, item: { type: 'userMessage', id: 'input-2', text: 'second steer', inputSource: 'steer' } },
        ]}
        statusModel={null}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={null}
        traceScope={{ threadId: 'thread-1', projectId: 'project-1' }}
      />,
    );

    expect(Array.from(container.querySelectorAll('.message-row')).map((node) => (
      node.getAttribute('data-message-id')
    ))).toEqual(['input-1', 'assistant-a', 'input-2', 'assistant-b']);
    expect(container.querySelector('[data-message-id="input-2"]')?.classList.contains('steer-message-row'))
      .toBe(true);
  });

  it('keeps one Turn rail entry when a Turn contains multiple input messages', () => {
    const entries = buildTurnHistoryEntries({
      messages: [
        { id: 'input-1', role: 'user', text: 'initial prompt', turnId: 'turn-1', inputTrace: { source: 'user' } },
        { id: 'input-2', role: 'user', text: 'second steer', turnId: 'turn-1', inputTrace: { source: 'steer' } },
        { id: 'assistant-1', role: 'assistant', text: 'answer', turnId: 'turn-1' },
      ],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'turn:turn-1', summary: 'initial prompt', source: 'user' });
  });

  it('renders a Turn rail, inline summary, and supports node navigation', () => {
    const user = { ...messages[0], inputTrace: { source: 'user', scope: { turnId: 'turn-1' } } };
    const node = document.createElement('div');
    node.scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    render(
      <ChatArea
        messages={[user, messages[1]]}
        threadItems={[]}
        statusModel={{
          scope: { turnId: 'turn-1' },
          lifecycle: 'running',
          nextAction: null,
        }}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={null}
        traceScope={{ threadId: 'thread-1', projectId: 'project-1' }}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Session Turn 导航' })).toBeDefined();
    expect(screen.getByRole('button', { name: /检查仓库结构，仓库结构已检查/ })).toBeDefined();
    expect(screen.queryByText('当前 Turn · 运行中')).toBeNull();
    expect(screen.getAllByText('仓库结构已检查。').length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('button', { name: /检查仓库结构，仓库结构已检查/ }));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    expect(node).toBeDefined();
  });

  it('keeps a manual step-limit notice in the message stream when the Turn rail is present', () => {
    render(
      <ChatArea
        messages={[messages[0], messages[1]]}
        threadItems={[]}
        statusModel={{
          scope: { turnId: 'turn-1' },
          lifecycle: 'step_limit',
          executionSettings: { continuationMode: 'manual' },
        }}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={{ status: 'step_limit', turnId: 'turn-1', steps: 21 }}
        traceScope={{ threadId: 'thread-1', projectId: 'project-1' }}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Session Turn 导航' })).toBeDefined();
    expect(screen.getByText('本轮达到运行步数上限')).toBeDefined();
    expect(screen.getByText(/手动推进已暂停在当前检查点。已执行 21 步。/)).toBeDefined();
    expect(screen.getByText(/可以继续发送指令推进下一轮/)).toBeDefined();
  });
});
