import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('keeps a prior text block folded when the next block begins', () => {
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

    expect(container.querySelector('.assistant-text-folded')?.textContent).toContain('已完成的步骤');
  });

  it('folds the preceding block when the final text delta becomes current', () => {
    const baseMessage = {
      id: 'assistant-1',
      role: 'assistant',
      blocks: [{
        type: 'thinking',
        id: 'thinking-1',
        content: '检查任务状态',
        isStreaming: true,
      }],
    };
    const { container, rerender } = render(
      <MessageItem message={baseMessage} isLast isGenerating />,
    );

    rerender(
      <MessageItem
        message={{
          ...baseMessage,
          blocks: [
            { ...baseMessage.blocks[0], isStreaming: true },
            { type: 'text', content: '任务已停止。', isStreaming: true },
          ],
        }}
        isLast
        isGenerating
      />,
    );

    expect(container.querySelector('.thinking-body')).toBeNull();
    expect(container.querySelector('.thinking-container.collapsed')).toBeTruthy();
    expect(container.querySelector('.thinking-preview')).toBeNull();
    expect(container.querySelector('.assistant-answer')?.textContent).toContain('任务已停止。');

    rerender(
      <MessageItem
        message={{
          ...baseMessage,
          blocks: [
            { ...baseMessage.blocks[0], isStreaming: false },
            { type: 'text', content: '任务已停止。' },
          ],
        }}
        isLast
        isGenerating={false}
      />,
    );

    expect(container.querySelector('.thinking-container.collapsed')).toBeTruthy();
    expect(container.querySelector('.thinking-preview')).toBeNull();
    expect(container.querySelector('.assistant-answer')?.textContent).toContain('任务已停止。');
    expect(screen.queryByRole('button', { name: '展开已收起的助手内容' })).toBeNull();
  });
});
