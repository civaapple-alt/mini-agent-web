import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AssistantTextBlock from '../components/AssistantTextBlock';
import MessageItem from '../components/MessageItem';

describe('AssistantTextBlock', () => {
  it('shows arriving text while active and keeps the final response expanded when settled', () => {
    const { container, rerender } = render(
      <AssistantTextBlock
        content="检查"
        isCurrentBlock
        isRunActive
      />,
    );

    expect(container.querySelector('.assistant-text-folded')).toBeNull();
    expect(container.querySelector('.assistant-answer')?.textContent).toContain('检查');

    rerender(
      <AssistantTextBlock
        content="检查完成。"
        isCurrentBlock
        isRunActive
      />,
    );
    expect(container.querySelector('.assistant-answer')?.textContent).toContain('检查完成。');
    expect(container.querySelector('.assistant-text-folded')).toBeNull();

    rerender(
      <AssistantTextBlock
        content="检查完成。"
        isCurrentBlock={false}
        isRunActive={false}
      />,
    );

    expect(container.querySelector('.assistant-text-folded')).toBeNull();
    expect(container.querySelector('.assistant-answer')?.textContent).toContain('检查完成。');
  });

  it('keeps progress text visible when later activity begins', () => {
    const { container, rerender } = render(
      <AssistantTextBlock content="已完成的步骤" isCurrentBlock isRunActive />,
    );

    rerender(
      <AssistantTextBlock
        content="已完成的步骤"
        isCurrentBlock={false}
        isRunActive
      />,
    );

    expect(container.querySelector('.assistant-text-folded')).toBeNull();
    expect(container.querySelector('.assistant-answer')?.textContent).toContain('已完成的步骤');
  });

  it('keeps the active execution segment ungrouped and folds it after the next segment starts', () => {
    const baseMessage = {
      id: 'assistant-1',
      role: 'assistant',
      blocks: [{
        type: 'thinking',
        id: 'thinking-1',
        content: '检查任务状态',
        isStreaming: false,
      }, {
        type: 'tool',
        id: 'tool-completed-1',
        name: 'shell',
        status: 'completed',
        output: 'ok',
      }, {
        type: 'text',
        id: 'progress-1',
        content: '我正在检查任务状态。',
        isStreaming: true,
      }],
    };
    const { container, rerender, unmount } = render(
      <MessageItem message={baseMessage} isLast isGenerating />,
    );

    rerender(
      <MessageItem
        message={{
          ...baseMessage,
          blocks: [
            { ...baseMessage.blocks[0], isStreaming: false },
            baseMessage.blocks[1],
            { ...baseMessage.blocks[2], content: '我正在核对结果。', isStreaming: false },
          ],
        }}
        isLast
        isGenerating
      />,
    );

    expect(container.querySelector('.assistant-answer')?.textContent).toContain('我正在核对结果。');
    expect(container.querySelector('.assistant-activity-group-summary')).toBeNull();
    expect(container.querySelector('.thinking-container')).toBeTruthy();

    const nextSegment = {
      id: 'assistant-2',
      role: 'assistant',
      turnId: 'turn-1',
      blocks: [{
        type: 'thinking',
        id: 'thinking-2',
        content: '继续核对',
        isStreaming: true,
      }],
    };
    rerender(
      <>
        <MessageItem key="segment-a" message={baseMessage} isLast={false} isGenerating />
        <MessageItem key="segment-b" message={nextSegment} isLast isGenerating />
      </>,
    );

    const assistantMessages = container.querySelectorAll('.message-row.assistant');
    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages[0].querySelector('.assistant-activity-group-summary')?.textContent)
      .toContain('已完成 2 项活动');
    expect(assistantMessages[0].querySelector('.assistant-activity-group-summary')?.getAttribute('aria-expanded'))
      .toBe('false');
    expect(assistantMessages[1].querySelector('.assistant-activity-group-summary')).toBeNull();
    expect(assistantMessages[1].querySelector('.thinking-container')).toBeTruthy();

    rerender(
      <MessageItem
        message={{
          ...baseMessage,
          blocks: [
            { ...baseMessage.blocks[0], isStreaming: false },
            { ...baseMessage.blocks[1], status: 'completed', output: 'ok' },
            { ...baseMessage.blocks[2], content: '我正在核对结果。', isStreaming: false },
            { type: 'text', id: 'answer-1', content: '任务已停止。' },
          ],
        }}
        isLast
        isGenerating={false}
      />,
    );

    expect(container.querySelector('.assistant-activity-group-summary')?.textContent).toContain('已完成 2 项活动');
    expect(container.querySelector('.thinking-body')).toBeNull();
    expect(container.querySelector('.assistant-activity-group-summary')?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelectorAll('.assistant-answer').length).toBe(2);
    expect(container.textContent).toContain('我正在核对结果。');
    expect(screen.getByText('任务已停止。')).toBeDefined();
    expect(screen.queryByRole('button', { name: '展开已收起的助手内容' })).toBeNull();

    unmount();
    const reloaded = render(
      <MessageItem
        message={{
          ...baseMessage,
          blocks: [
            { ...baseMessage.blocks[0], isStreaming: false },
            { ...baseMessage.blocks[1], status: 'completed', output: 'ok' },
            { ...baseMessage.blocks[2], content: '我正在核对结果。', isStreaming: false },
            { type: 'text', id: 'answer-1', content: '任务已停止。' },
          ],
        }}
        isLast
        isGenerating={false}
      />,
    );
    expect(reloaded.container.querySelector('.assistant-activity-group-summary')?.getAttribute('aria-expanded'))
      .toBe('false');
    expect(reloaded.container.textContent).toContain('我正在核对结果。');
    expect(screen.getByText('任务已停止。')).toBeDefined();
  });

  it('keeps a manual activity-summary toggle by stable block id while the page remains open', () => {
    const message = {
      id: 'assistant-manual-fold',
      role: 'assistant',
      blocks: [
        { type: 'thinking', id: 'thinking-manual-fold', content: '可展开思考', isStreaming: false },
        { type: 'tool', id: 'tool-manual-fold', name: 'read_file', status: 'completed', output: '内容' },
      ],
    };
    const firstRender = render(<MessageItem message={message} isLast isGenerating={false} />);
    fireEvent.click(screen.getByRole('button', { name: /已完成 2 项活动/ }));
    expect(firstRender.container.querySelector('.assistant-activity-group-summary')?.getAttribute('aria-expanded'))
      .toBe('true');

    firstRender.unmount();
    const secondRender = render(<MessageItem message={message} isLast isGenerating={false} />);
    expect(secondRender.container.querySelector('.assistant-activity-group-summary')?.getAttribute('aria-expanded'))
      .toBe('true');
  });
});
