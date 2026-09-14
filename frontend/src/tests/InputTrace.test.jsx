import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MessageItem from '../components/MessageItem';
import ThreadHistoryPane from '../components/ThreadHistoryPane';
import { createInputTrace, getInputTrace } from '../utils/inputTrace';

describe('input trace presentation', () => {
  it('captures bounded live scope and execution settings', () => {
    const trace = createInputTrace({
      threadId: 't-1',
      projectId: 'project-a',
      turnId: 'turn-1',
      accessScope: 'project',
      policy: 'trusted',
      continuationMode: 'continuous',
      planActive: true,
      goalActive: false,
      images: ['data:image/png;base64,a'],
      referencedFiles: ['src/App.jsx'],
    });

    expect(trace.scope).toEqual({
      projectId: 'project-a',
      threadId: 't-1',
      turnId: 'turn-1',
    });
    expect(trace.execution).toMatchObject({
      accessScope: 'project',
      policy: 'trusted',
      continuationMode: 'continuous',
      planActive: true,
    });
    expect(trace.attachments).toMatchObject({ imageCount: 1, known: true });
    expect(trace.attachments.referencedFiles).toEqual(['src/App.jsx']);
  });

  it('does not invent execution settings for a historical message', () => {
    const trace = getInputTrace(
      { role: 'user', id: 'history-1', text: '历史问题' },
      { threadId: 't-history', projectId: 'project-a' },
    );

    expect(trace.historical).toBe(true);
    expect(trace.execution).toBeNull();
    expect(trace.scope).toMatchObject({
      projectId: 'project-a',
      threadId: 't-history',
    });
    expect(trace.attachments.known).toBe(false);
  });

  it('opens the hover trace and supports adjusting the original input', () => {
    const message = {
      id: 'user-1',
      role: 'user',
      text: '检查项目状态',
      images: ['data:image/png;base64,a'],
      referencedFiles: ['README.md'],
      inputTrace: createInputTrace({
        threadId: 't-1',
        projectId: 'project-a',
        turnId: 'turn-1',
        accessScope: 'project',
        policy: 'interactive',
        continuationMode: 'manual',
        capturedAt: '2026-09-14T10:00:00.000Z',
        images: ['data:image/png;base64,a'],
        referencedFiles: ['README.md'],
      }),
    };
    const onAdjustPrompt = vi.fn();
    const onViewThreadHistory = vi.fn();

    render(
      <MessageItem
        message={message}
        isLast={false}
        isGenerating={false}
        onAdjustPrompt={onAdjustPrompt}
        onViewThreadHistory={onViewThreadHistory}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '查看输入追踪' }));
    expect(screen.getByRole('dialog', { name: '输入追踪' })).toBeDefined();
    expect(screen.getByText(/项目范围 · 交互批准 · 手动推进/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '调整输入' }));
    expect(onAdjustPrompt).toHaveBeenCalledWith(message);
    fireEvent.click(screen.getByRole('button', { name: '查看 Thread 历史' }));
    expect(onViewThreadHistory).toHaveBeenCalledWith('user-1');
  });

  it('shows the current thread input history with an adjust action', () => {
    const message = {
      id: 'history-1',
      role: 'user',
      text: '查看历史输入',
      turnId: 'turn-7',
    };
    const onAdjustPrompt = vi.fn();

    render(
      <ThreadHistoryPane
        messages={[message]}
        threadId="t-history"
        projectId="project-a"
        onAdjustPrompt={onAdjustPrompt}
      />,
    );

    expect(screen.getByText('查看历史输入')).toBeDefined();
    expect(screen.getByText(/历史设置未记录/)).toBeDefined();
    expect(screen.getByText(/Turn: turn-7/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '调整输入' }));
    expect(onAdjustPrompt).toHaveBeenCalledWith(message);
  });
});
