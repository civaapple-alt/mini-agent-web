import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PendingMessageDock from '../components/PendingMessageDock';

const message = (id, prompt) => ({
  id,
  prompt,
  images: [],
  referencedFiles: [],
  status: 'queued',
});

describe('PendingMessageDock', () => {
  it('offers steer, edit, and delete actions for a single queued message', () => {
    const onSteer = vi.fn();
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    const item = message('queued-1', '继续检查工具');

    render(
      <PendingMessageDock
        messages={[item]}
        onSteer={onSteer}
        onEdit={onEdit}
        onUpdate={vi.fn()}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '实时纠偏' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '删除排队消息' }));

    expect(onSteer).toHaveBeenCalledWith(item);
    expect(onEdit).toHaveBeenCalledWith(item);
    expect(onRemove).toHaveBeenCalledWith('queued-1');
  });

  it('edits inline when multiple messages are queued', () => {
    const onUpdate = vi.fn();
    const items = [message('queued-1', '第一条'), message('queued-2', '第二条')];

    render(
      <PendingMessageDock
        messages={items}
        onSteer={vi.fn()}
        onEdit={vi.fn()}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
      />,
    );

    const editButtons = screen.getAllByRole('button', { name: '编辑' });
    fireEvent.click(editButtons[1]);
    const editor = screen.getByRole('textbox', { name: '编辑排队消息' });
    fireEvent.change(editor, { target: { value: '已修改第二条' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(onUpdate).toHaveBeenCalledWith('queued-2', '已修改第二条');
  });
});
