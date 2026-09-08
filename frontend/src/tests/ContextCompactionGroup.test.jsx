import React from 'react';
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ContextCompactionGroup from '../components/ContextCompactionGroup';

describe('ContextCompactionGroup', () => {
  it('collapses consecutive compactions and expands their details', () => {
    render(
      <ContextCompactionGroup
        items={[
          { id: 'compact-1', turnId: 'turn-1', status: 'completed' },
          { id: 'compact-2', turnId: 'turn-1', status: 'completed' },
          { id: 'compact-3', turnId: 'turn-2', status: 'completed' },
        ]}
      />,
    );

    const summary = screen.getByRole('button', { name: /上下文压缩 ×3/ });
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('compact-1')).toBeNull();

    fireEvent.click(summary);

    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByText('Turn turn-1')).toHaveLength(2);
    expect(screen.getByText('compact-3')).toBeDefined();
  });
});
