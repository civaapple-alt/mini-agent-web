import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SidePanel from '../components/SidePanel';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getWorkflowFiles: vi.fn(),
    getWorkflowFileContent: vi.fn(),
    getWorkflowState: vi.fn(),
  },
}));

describe('SidePanel plan viewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getWorkflowFiles.mockResolvedValue({
      files: [
        { path: 'plan/plan.md', size: 42 },
        { path: 'goal/plan.md', size: 18 },
        { path: 'README.md', size: 12 },
      ],
    });
    api.getWorkflowFileContent.mockResolvedValue({
      content: '# Implementation plan\n\n- [ ] Keep the plan readable',
    });
    api.getWorkflowState.mockResolvedValue({
      builtin_tools: ['read_file', 'apply_patch', 'shell', 'read_image', 'scheduled_task'],
      available_builtin_tools: ['read_file', 'apply_patch', 'shell', 'read_image', 'scheduled_task'],
      goal: null,
    });
  });

  it('opens a dedicated top-level plan tab with a full-height markdown reader', async () => {
    render(
      <SidePanel
        isOpen
        initialTab="plan_view"
        planActive
        threadId="thread-1"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '计划' })).toBeDefined();
    expect(screen.getByText('阅读当前会话生成的计划与配套文件')).toBeDefined();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Implementation plan' })).toBeDefined());
    expect(screen.getByText('Keep the plan readable')).toBeDefined();
    expect(api.getWorkflowFiles).toHaveBeenCalledWith('thread-1', expect.objectContaining({ projectId: null }));
    expect(api.getWorkflowFileContent).toHaveBeenCalledWith(
      'plan/plan.md',
      'thread-1',
      expect.objectContaining({ projectId: null }),
    );

    expect(screen.queryByRole('button', { name: /README\.md/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /goal\/plan\.md/ })).toBeNull();
    expect(screen.getByText('plan/plan.md')).toBeDefined();
    expect(document.querySelector('.plan-viewer-full-width')).toBeTruthy();
  });

  it('keeps builtin tools in the workspace and gives goals their own tab', async () => {
    render(
      <SidePanel
        isOpen
        initialTab="tools"
        threadId="thread-1"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '工具' })).toBeDefined();
    expect(screen.getByText('内置工具权限控制 (Builtin Tools)')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '目标' }));
    await waitFor(() => expect(screen.getByText('线程目标 (Thread Goal)')).toBeDefined());
    expect(screen.queryByText('内置工具权限控制 (Builtin Tools)')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: /goal\/plan\.md/ })).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /goal\/plan\.md/ }));
    await waitFor(() => expect(api.getWorkflowFileContent).toHaveBeenCalledWith(
      'goal/plan.md',
      'thread-1',
      expect.objectContaining({ projectId: null }),
    ));
    expect(document.querySelector('.goal-file-content')).toBeTruthy();
  });
});
