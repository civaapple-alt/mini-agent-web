import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ChatArea from '../components/ChatArea';
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

  it('groups only adjacent settled internal blocks and keeps failures visible', () => {
    const grouped = groupSettledAssistantBlocks([
      { type: 'thinking', id: 'thinking-1', content: 'done', isStreaming: false },
      { type: 'tool', id: 'tool-1', name: 'shell', status: 'completed' },
      { type: 'tool', id: 'tool-2', name: 'shell', status: 'failed', error: 'boom' },
      { type: 'text', content: 'partial' },
    ]);
    expect(grouped[0].type).toBe('activityGroup');
    expect(grouped[0].items).toHaveLength(2);
    expect(grouped[1].type).toBe('tool');
    expect(grouped[2].type).toBe('text');
  });
});

describe('ChatArea direction cues', () => {
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
