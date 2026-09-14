import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Header from '../components/Header';

describe('Header session identity', () => {
  it('shows the display title and the actual Session ID', () => {
    render(
      <Header
        currentThread="default"
        threadTitle="默认会话"
        threadSummary=""
        sessionId="s-1a09e9d943c-9b40-0"
        isConnected
        onOpenSidePanel={vi.fn()}
        onOpenSettings={vi.fn()}
        onRenameThread={vi.fn()}
        onUpdateSummary={vi.fn()}
      />,
    );

    expect(screen.getByText('默认会话')).toBeDefined();
    expect(screen.getByText('Session s-1a09e9d943c-9b40-0')).toBeDefined();
    expect(screen.getByTitle('实际 Session ID: s-1a09e9d943c-9b40-0')).toBeDefined();
  });
});
