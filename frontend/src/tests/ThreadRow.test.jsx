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
