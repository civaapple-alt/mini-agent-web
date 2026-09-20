import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SidePanel from '../components/SidePanel';
import ChildSessionViewer from '../components/ChildSessionViewer';
import { api } from '../api';
import { threadApi } from '../api/threads.js';

vi.mock('../api', () => ({
  api: {
    readThread: vi.fn(),
    listThreadItems: vi.fn(),
  },
}));

vi.mock('../api/threads.js', () => ({
  threadApi: {
    listBackgroundTasks: vi.fn(),
    listScheduledTasks: vi.fn(),
  },
}));

const child = {
  operation_id: 'operation-child-a',
  child_thread_id: 'child-a',
  parent_thread_id: 'parent-a',
  project_id: 'project-a',
  title: 'Review child task',
  status: 'completed',
  execution_mode: 'parallel',
  child_session_available: true,
  duration_ms: 2400,
};

describe('child agents drawer tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    threadApi.listBackgroundTasks.mockResolvedValue({ data: [] });
    threadApi.listScheduledTasks.mockResolvedValue({ data: [] });
    api.readThread.mockResolvedValue({
      turn_active: false,
      parent_session_id: 'parent-a',
      parent_checkpoint_seq: 42,
      messages: [
        { role: 'user', text: 'INHERITED_PARENT_PROMPT' },
        { role: 'assistant', text: 'INHERITED_PARENT_RESPONSE' },
      ],
    });
    api.listThreadItems.mockResolvedValue({
      data: [
        {
          threadId: 'child-a',
          turnId: 'child-turn-1',
          item: { id: 'child-input', type: 'userMessage', text: 'CHILD_LOCAL_PROMPT' },
        },
        {
          threadId: 'child-a',
          turnId: 'child-turn-1',
          item: { id: 'child-output', type: 'agentMessage', text: 'CHILD_LOCAL_RESULT' },
        },
      ],
      next_cursor: null,
    });
  });

  it('keeps task selection and detail inside a dedicated drawer tab', async () => {
    const { container } = render(
      <SidePanel
        isOpen
        initialTab="status"
        threadId="parent-a"
        projectId="project-a"
        childTasks={[child]}
        childTasksLoading={false}
      />,
    );

    expect(screen.getByText('当前运行状态')).toBeTruthy();
    expect(container.querySelectorAll('.status-detail-disclosure')).toHaveLength(3);
    expect([...container.querySelectorAll('.status-detail-disclosure')].every((node) => !node.open)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '查看子智能体' }));
    expect(screen.queryByText('当前运行状态')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '显示已结束任务（1）' }));
    expect(screen.getByText('Review child task')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看' }));

    await waitFor(() => expect(screen.getAllByText('CHILD_LOCAL_RESULT').length).toBe(2));
    expect(screen.getByText(/来源父会话/)).toBeTruthy();
    expect(screen.queryByText('INHERITED_PARENT_PROMPT')).toBeNull();
    expect(screen.queryByText('INHERITED_PARENT_RESPONSE')).toBeNull();
    expect(api.listThreadItems).toHaveBeenCalledWith(
      'child-a',
      expect.objectContaining({ projectId: 'project-a', limit: 128 }),
    );

    fireEvent.click(screen.getByRole('button', { name: '返回子任务' }));
    fireEvent.click(screen.getByRole('button', { name: '显示已结束任务（1）' }));
    expect(screen.getByText('Review child task')).toBeTruthy();
    const childTab = [...container.querySelectorAll('.sidepanel-tabs .panel-tab-btn')]
      .find((button) => button.textContent.includes('子智能体'));
    expect(childTab.className).toContain('active');
  });

  it('renders as a non-modal dock beside the conversation and can return to overlay mode', () => {
    const onToggleDock = vi.fn();
    const { container } = render(
      <SidePanel
        isOpen
        isDocked
        dockPreference
        canDock
        onToggleDock={onToggleDock}
        initialTab="child_agents"
        threadId="parent-a"
        projectId="project-a"
        childTasks={[child]}
        childTasksLoading={false}
      />,
    );

    expect(container.querySelector('.sidepanel-docked')).toBeTruthy();
    expect(container.querySelector('.sidepanel-overlay')).toBeNull();
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '恢复浮层显示' }));
    expect(onToggleDock).toHaveBeenCalledOnce();
  });

  it('uses modal overlay on narrow windows while keeping the dock preference available', () => {
    const onToggleDock = vi.fn();
    const { container } = render(
      <SidePanel
        isOpen
        isDocked={false}
        dockPreference
        canDock={false}
        onToggleDock={onToggleDock}
        initialTab="child_agents"
        childTasks={[]}
        childTasksLoading={false}
      />,
    );

    expect(container.querySelector('.sidepanel-overlay')).toBeTruthy();
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '取消宽屏右侧停靠' }));
    expect(onToggleDock).toHaveBeenCalledOnce();
  });

  it('shows an explicit empty state when a fork has no child-local items', async () => {
    api.listThreadItems.mockResolvedValue({ data: [], next_cursor: null });
    render(
      <ChildSessionViewer
        child={{ ...child, status: 'completed' }}
        projectId="project-a"
        onBack={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText('暂无子代理活动')).toBeTruthy());
    expect(screen.queryByText('INHERITED_PARENT_PROMPT')).toBeNull();
    expect(screen.getByText(/不会回填父会话 checkpoint 内容/)).toBeTruthy();
  });

  it('puts the latest report and live duration first for a running child', async () => {
    api.readThread.mockResolvedValue({ turn_active: true, messages: [] });
    render(
      <ChildSessionViewer
        child={{
          ...child,
          status: 'running',
          started_at_ms: Date.now() - 5000,
          reports: [{ report: '已完成资料采集，正在核对来源', timestamp_ms: Date.now() }],
        }}
        projectId="project-a"
        onBack={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText('子代理正在执行')).toBeTruthy());
    expect(screen.getByText('已完成资料采集，正在核对来源')).toBeTruthy();
    expect(screen.queryByText('最终回复')).toBeNull();
  });
});
