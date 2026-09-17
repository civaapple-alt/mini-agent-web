import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SidePanel from '../components/SidePanel';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getWorkflowFiles: vi.fn(),
    getWorkflowFileContent: vi.fn(),
  },
}));

describe('SidePanel plan viewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getWorkflowFiles.mockResolvedValue({
      files: [
        { path: 'plan/plan.md', size: 42 },
        { path: 'README.md', size: 18 },
      ],
    });
    api.getWorkflowFileContent.mockResolvedValue({
      content: '# Implementation plan\n\n- [ ] Keep the plan readable',
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

    expect(screen.getByRole('button', { name: '计划查看' })).toBeDefined();
    expect(screen.getByText('阅读当前会话生成的计划与配套文件')).toBeDefined();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Implementation plan' })).toBeDefined());
    expect(screen.getByText('Keep the plan readable')).toBeDefined();
    expect(api.getWorkflowFiles).toHaveBeenCalledWith('thread-1', expect.objectContaining({ projectId: null }));
    expect(api.getWorkflowFileContent).toHaveBeenCalledWith(
      'plan/plan.md',
      'thread-1',
      expect.objectContaining({ projectId: null }),
    );

    fireEvent.click(screen.getByRole('button', { name: /README\.md/ }));
    await waitFor(() => expect(api.getWorkflowFileContent).toHaveBeenCalledWith(
      'README.md',
      'thread-1',
      expect.objectContaining({ projectId: null }),
    ));
  });
});
