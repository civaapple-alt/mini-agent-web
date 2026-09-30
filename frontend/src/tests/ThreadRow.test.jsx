import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ThreadRow from '../components/sidebar/ThreadRow';

describe('ThreadRow session identity', () => {
  it('shows the actual Session ID below the display title', () => {
    render(
      <ThreadRow
        thread={{
          thread_id: 'default',
          title: '默认会话',
          project: 'blender-intro',
          session_id: 's-1a09e9d943c-9b40-0',
        }}
        currentThread="default"
        currentThreadProject="blender-intro"
        isGenerating={false}
        activeMenuThread={null}
        onSelectThread={vi.fn()}
        onToggleMenu={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByText('默认会话')).toBeDefined();
    expect(screen.getByText('s-1a09e9d943c-9b40-0')).toBeDefined();
    expect(screen.getByTitle('实际 Session ID: s-1a09e9d943c-9b40-0')).toBeDefined();
  });

  it('shows an attention icon and keeps the row as the navigation target', () => {
    const onSelectThread = vi.fn();
    const { container } = render(
      <ThreadRow
        thread={{
          thread_id: 'default',
          title: '默认会话',
          project: 'blender-intro',
          attention_reasons: ['pending_approval', 'child_report'],
        }}
        currentThread="other"
        currentThreadProject="blender-intro"
        isGenerating={false}
        activeMenuThread={null}
        onSelectThread={onSelectThread}
        onToggleMenu={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    const attentionIcon = screen.getByRole('img', {
      name: '需要留意：有待处理的审批、子任务有新报告',
    });
    expect(attentionIcon).toBeDefined();

    fireEvent.click(container.querySelector('.nested-thread-item'));
    expect(onSelectThread).toHaveBeenCalledWith('default', 'blender-intro');
  });

  it('shows a visible answer badge when a background child Session asks the user', () => {
    render(
      <ThreadRow
        thread={{
          thread_id: 'parent',
          title: 'Parent Session',
          project: 'blender-intro',
          attention_reasons: ['child_user_input'],
        }}
        currentThread="other"
        currentThreadProject="blender-intro"
        isGenerating={false}
        activeMenuThread={null}
        onSelectThread={vi.fn()}
        onToggleMenu={vi.fn()}
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByText('需回答')).toBeTruthy();
    expect(screen.getByTitle('子任务正在等待用户回答')).toBeTruthy();
    expect(screen.getByRole('img', { name: '需要留意：子任务需要用户回答' })).toBeTruthy();
  });

  it('offers a copy action for the actual Session ID', () => {
    const onAction = vi.fn();
    render(
      <ThreadRow
        thread={{
          thread_id: 'default',
          title: '默认会话',
          project: 'blender-intro',
          session_id: 's-1a09e9d943c-9b40-0',
        }}
        currentThread="default"
        currentThreadProject="blender-intro"
        isGenerating={false}
        activeMenuThread="blender-intro:default"
        onSelectThread={vi.fn()}
        onToggleMenu={vi.fn()}
        onAction={onAction}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '复制 Session ID' }));

    expect(onAction).toHaveBeenCalledWith(
      expect.anything(),
      'copy_session_id',
      expect.objectContaining({ session_id: 's-1a09e9d943c-9b40-0' }),
    );
  });
});
