import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
