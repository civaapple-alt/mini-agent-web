import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Header from '../components/Header';

function renderHeader(onRenameThread = vi.fn()) {
  render(
    <Header
      currentThread="default"
      threadTitle="默认会话"
      threadSummary=""
      sessionId="s-1a09e9d943c-9b40-0"
      isConnected
      onOpenSidePanel={vi.fn()}
      onOpenSettings={vi.fn()}
      onRenameThread={onRenameThread}
      onUpdateSummary={vi.fn()}
    />,
  );
  return onRenameThread;
}

describe('Header session identity', () => {
  it('shows the display title and the actual Session ID', () => {
    renderHeader();

    expect(screen.getByText('默认会话')).toBeDefined();
    expect(screen.getByText('Session s-1a09e9d943c-9b40-0')).toBeDefined();
    expect(screen.getByTitle('复制实际 Session ID')).toBeDefined();
  });

  it('cancels a title edit on blur without renaming the session', () => {
    const onRenameThread = renderHeader();

    fireEvent.click(screen.getByTitle('点击重命名会话'));
    const input = screen.getByDisplayValue('默认会话');
    fireEvent.change(input, { target: { value: '临时标题' } });
    fireEvent.blur(input);

    expect(onRenameThread).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue('临时标题')).toBeNull();
  });

  it('renames only after an explicit confirmation', () => {
    const onRenameThread = renderHeader();

    fireEvent.click(screen.getByTitle('点击重命名会话'));
    fireEvent.change(screen.getByDisplayValue('默认会话'), { target: { value: '正式标题' } });
    fireEvent.click(screen.getByTitle('确认'));

    expect(onRenameThread).toHaveBeenCalledWith('正式标题');
  });
});
