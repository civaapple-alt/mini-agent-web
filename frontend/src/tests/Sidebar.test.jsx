import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Sidebar from '../components/Sidebar';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    listProjects: vi.fn(),
    createProject: vi.fn(),
    startThread: vi.fn(),
  },
}));

describe('Sidebar project creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listProjects.mockResolvedValue({
      current_project: null,
      projects: [],
      recent_projects: [],
    });
    api.createProject.mockResolvedValue({
      project: {
        id: 'ma-three',
        name: 'ma-three',
        primary_path: 'D:\\workspace\\ma-three',
      },
    });
    api.startThread.mockResolvedValue({
      thread_id: 'default',
      project: 'ma-three',
    });
  });

  it('reuses the canonical default Session when creating a project', async () => {
    const onSelectThread = vi.fn();

    render(
      <Sidebar
        threads={[]}
        currentThread="default"
        currentThreadProject={null}
        isGenerating={false}
        onSelectThread={onSelectThread}
        onNewThread={vi.fn()}
        onForkThread={vi.fn()}
        onCloseThread={vi.fn()}
        onRenameThread={vi.fn()}
        onUpdateSummary={vi.fn()}
        onRefreshThreads={vi.fn()}
        onToast={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle('新建工作区项目'));
    fireEvent.change(screen.getByPlaceholderText('项目名称'), {
      target: { value: 'ma-three' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));

    await waitFor(() => {
      expect(api.startThread).toHaveBeenCalledWith(
        'default',
        '默认会话',
        'ma-three',
        { projectId: 'ma-three' },
      );
      expect(onSelectThread).toHaveBeenCalledWith('default', 'ma-three');
    });
  });
});
