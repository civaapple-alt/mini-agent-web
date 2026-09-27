import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Sidebar from '../components/Sidebar';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    startThread: vi.fn(),
    getModelCatalog: vi.fn(),
    inspectProjectSessions: vi.fn(),
    repairProjectSession: vi.fn(),
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
    api.getModelCatalog.mockResolvedValue({
      catalog: { providers: [], projectDefaults: {} },
    });
    api.updateProject.mockResolvedValue({ status: 'updated' });
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

  it('keeps the project list scrollable instead of truncating it to five projects', async () => {
    api.listProjects.mockResolvedValue({
      current_project: { id: 'project-1', name: 'project-1' },
      projects: Array.from({ length: 6 }, (_, index) => ({
        id: `project-${index + 1}`,
        name: `project-${index + 1}`,
      })),
      recent_projects: [],
    });

    render(
      <Sidebar
        threads={[]}
        currentThread="default"
        currentThreadProject={null}
        isGenerating={false}
        onSelectThread={vi.fn()}
        onNewThread={vi.fn()}
        onForkThread={vi.fn()}
        onCloseThread={vi.fn()}
        onRenameThread={vi.fn()}
        onUpdateSummary={vi.fn()}
        onRefreshThreads={vi.fn()}
        onToast={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('project-6')).toBeTruthy();
    });
    expect(screen.queryByText('展开显示')).toBeNull();
  });

  it('can collapse and expand the project section independently from recent sessions', async () => {
    api.listProjects.mockResolvedValue({
      current_project: { id: 'memory-card', name: 'memory-card' },
      projects: [{ id: 'memory-card', name: 'memory-card' }],
      recent_projects: [],
    });

    render(
      <Sidebar
        threads={[]}
        currentThread="default"
        currentThreadProject={null}
        isGenerating={false}
        onSelectThread={vi.fn()}
        onNewThread={vi.fn()}
        onForkThread={vi.fn()}
        onCloseThread={vi.fn()}
        onRenameThread={vi.fn()}
        onUpdateSummary={vi.fn()}
        onRefreshThreads={vi.fn()}
        onToast={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText('memory-card')).toBeTruthy());
    const toggle = screen.getByRole('button', { name: '项目' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('memory-card')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText('memory-card')).toBeTruthy();
  });

  it('keeps project editor open when project model selection is still unsaved', async () => {
    const project = {
      id: 'project-a',
      name: 'project-a',
      primary_path: '/workspace/project-a',
      source_folders: [{ name: 'project-a', path: '/workspace/project-a', is_primary: true }],
    };
    api.listProjects.mockResolvedValue({
      current_project: project,
      projects: [project],
      recent_projects: [],
    });
    api.getModelCatalog.mockResolvedValue({
      catalog: {
        providers: [{
          id: 'deepseek',
          name: 'DeepSeek',
          enabled: true,
          baseUrl: 'https://example.test',
          apiKeyConfigured: true,
          models: [{ id: 'deepseek-r1', name: 'DeepSeek R1', enabled: true }],
        }],
        projectDefaults: {},
      },
    });
    const onToast = vi.fn();
    render(
      <Sidebar
        threads={[]}
        currentThread="default"
        currentThreadProject="project-a"
        isGenerating={false}
        onSelectThread={vi.fn()}
        onNewThread={vi.fn()}
        onForkThread={vi.fn()}
        onCloseThread={vi.fn()}
        onRenameThread={vi.fn()}
        onUpdateSummary={vi.fn()}
        onRefreshThreads={vi.fn()}
        onToast={onToast}
      />,
    );

    await waitFor(() => expect(screen.getByText('project-a')).toBeTruthy());
    fireEvent.click(screen.getByTitle('编辑项目'));
    const modelSelect = await screen.findByRole('combobox', { name: '项目默认模型' });
    fireEvent.change(modelSelect, { target: { value: 'deepseek::deepseek-r1' } });
    fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }));

    await waitFor(() => expect(api.updateProject).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: '项目默认模型' })).toBeTruthy();
    expect(onToast).toHaveBeenCalledWith(
      expect.stringContaining('项目默认模型尚未保存，请单独保存'),
      'info',
    );
  });
});

describe('Sidebar session actions', () => {
  const project = {
    id: 'memory-card',
    name: 'memory-card',
    primary_path: 'D:\\workspace\\memory-card',
  };

  const thread = {
    thread_id: 't-1',
    title: '会话一',
    project: 'memory-card',
    summary: '旧摘要',
    session_id: 's-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    api.listProjects.mockResolvedValue({
      current_project: project,
      projects: [project],
      recent_projects: [],
    });
  });

  const renderSessionSidebar = (overrides = {}) => render(
    <Sidebar
      threads={[thread]}
      currentThread={thread.thread_id}
      currentThreadProject={thread.project}
      isGenerating={false}
      onSelectThread={vi.fn()}
      onNewThread={vi.fn()}
      onForkThread={vi.fn()}
      onCloseThread={vi.fn()}
      onRenameThread={vi.fn()}
      onUpdateSummary={vi.fn()}
      onRefreshThreads={vi.fn()}
      onToast={vi.fn()}
      {...overrides}
    />,
  );

  const openThreadMenu = async () => {
    await waitFor(() => expect(screen.getByText(thread.title)).toBeTruthy());
    fireEvent.click(screen.getByTitle('会话选项'));
  };

  it('opens the project Session doctor and requires confirmation before repairing a tail', async () => {
    const report = {
      schema_version: 1,
      scanned_sessions: 1,
      sessions_truncated: false,
      findings_truncated: false,
      counts: {
        inspection: { inspected: 1, locked_unverified: 0, unreadable: 0 },
        integrity: { complete: 0, history_incomplete: 0, invalid: 0, unknown: 0 },
        recovery: { resumable: 1, unavailable: 0, unknown: 0 },
        repairable_tails: 1,
      },
      findings: [{
        session_id: 's-tail',
        issue_code: 'incomplete_tail',
        inspection: 'inspected',
        integrity: 'complete',
        recovery: 'resumable',
        incomplete_tail: true,
        repair_available: true,
        byte_offset: 128,
        line: 4,
        recommendation: '末尾记录未完整写入。可先备份，再截去不完整尾部。',
      }],
    };
    const repairedReport = {
      ...report,
      counts: {
        ...report.counts,
        repairable_tails: 0,
        integrity: { ...report.counts.integrity, complete: 1 },
      },
      findings: [{ ...report.findings[0], issue_code: 'healthy', incomplete_tail: false, repair_available: false }],
    };
    api.inspectProjectSessions
      .mockResolvedValueOnce(report)
      .mockResolvedValueOnce(repairedReport);
    api.repairProjectSession.mockResolvedValue({
      session_id: 's-tail',
      backup_path: 'recovery-backups/workspace/s-tail/backup.jsonl',
      finding: repairedReport.findings[0],
    });

    renderSessionSidebar();
    await waitFor(() => expect(screen.getByText(thread.title)).toBeTruthy());
    fireEvent.click(screen.getByTitle('项目详情与工作区'));
    fireEvent.click(screen.getByRole('button', { name: '检查 Session 数据' }));

    expect(await screen.findByRole('dialog', { name: '检查 Session 数据' })).toBeTruthy();
    expect(await screen.findByText('位置：第 4 行')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '备份并修复' }));
    expect(api.repairProjectSession).not.toHaveBeenCalled();
    expect(screen.getByText(/历史缺口不会被补造/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '备份并修复' }));
    await waitFor(() => {
      expect(api.repairProjectSession).toHaveBeenCalledWith('memory-card', 's-tail');
      expect(api.inspectProjectSessions).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText(/原始日志备份在 recovery-backups\/workspace\/s-tail\/backup.jsonl/)).toBeTruthy();
    expect(screen.getByText('历史：历史完整')).toBeTruthy();
  });

  it('uses an in-app dialog for renaming instead of the native prompt', async () => {
    const onRenameThread = vi.fn();

    renderSessionSidebar({ onRenameThread });
    await openThreadMenu();
    fireEvent.click(screen.getByRole('button', { name: '重命名' }));

    expect(screen.getByRole('dialog', { name: '重命名会话' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('会话名称'), {
      target: { value: '新的会话名称' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(onRenameThread).toHaveBeenCalledWith(
      thread.thread_id,
      '新的会话名称',
      thread.project,
    );
  });

  it('uses an in-app dialog for summary editing', async () => {
    const onUpdateSummary = vi.fn();

    renderSessionSidebar({ onUpdateSummary });
    await openThreadMenu();
    fireEvent.click(screen.getByRole('button', { name: '指定摘要' }));

    expect(screen.getByRole('dialog', { name: '指定会话摘要' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('阶段摘要'), {
      target: { value: '新的执行摘要' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存摘要' }));

    expect(onUpdateSummary).toHaveBeenCalledWith(
      thread.thread_id,
      '新的执行摘要',
      thread.project,
    );
  });

  it('requires confirmation before fork and close actions execute', async () => {
    const onForkThread = vi.fn();
    const onCloseThread = vi.fn();

    renderSessionSidebar({ onForkThread, onCloseThread });
    await openThreadMenu();
    fireEvent.click(screen.getByRole('button', { name: '精确派生（默认）' }));

    expect(onForkThread).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '确认精确派生' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认派生' }));
    expect(onForkThread).toHaveBeenCalledWith(thread.thread_id, thread.project, 'exact');

    await openThreadMenu();
    fireEvent.click(screen.getByRole('button', { name: '关闭会话' }));

    expect(onCloseThread).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '确认关闭会话' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认关闭' }));
    expect(onCloseThread).toHaveBeenCalledWith(thread.thread_id, thread.project);
  });

  it('shows only the active Turn status in the session list', async () => {
    renderSessionSidebar({
      currentThread: 't-running',
      threads: [
        {
          ...thread,
          last_turn_status: 'completed',
          process_online: true,
          turn_active: false,
        },
        {
          ...thread,
          thread_id: 't-running',
          title: '运行中的会话',
          last_turn_status: 'in_progress',
          process_online: true,
          turn_active: true,
        },
      ],
    });

    await waitFor(() => expect(screen.getByText('运行中的会话')).toBeTruthy());
    expect(screen.getByText('运行中')).toBeTruthy();
    expect(screen.queryByText('已完成')).toBeNull();
    expect(screen.queryByText('待命')).toBeNull();
  });

  it('orders project sessions by activity and shows relative activity time', async () => {
    const now = Date.now();
    const { container } = renderSessionSidebar({
      threads: [
        {
          ...thread,
          thread_id: 't-oldest',
          title: '最早的会话',
          updated_at: new Date(now - 4 * 86_400_000).toISOString(),
        },
        {
          ...thread,
          thread_id: 't-newest',
          title: '最近的会话',
          updated_at: new Date(now - 20 * 60_000).toISOString(),
        },
        {
          ...thread,
          thread_id: 't-middle',
          title: '中间的会话',
          updated_at: new Date(now - 2 * 3_600_000).toISOString(),
        },
        {
          ...thread,
          thread_id: 't-unknown',
          title: '时间未知的会话',
          updated_at: null,
        },
      ],
    });

    await waitFor(() => expect(screen.getByText('最近的会话')).toBeTruthy());

    const rows = [...container.querySelectorAll('.nested-thread-item')];
    expect(rows.map((row) => row.querySelector('.nested-thread-title').textContent))
      .toEqual(['最近的会话', '中间的会话', '最早的会话', '时间未知的会话']);
    expect(rows.map((row) => row.querySelector('.nested-thread-updated-at').textContent))
      .toEqual(['20 分钟前', '2 小时前', '4 天前', '时间未知']);
  });

  it('hides delegated child sessions but keeps ordinary user forks in the project list', async () => {
    renderSessionSidebar({
      threads: [
        { ...thread, thread_id: 't-parent', title: '父会话' },
        {
          ...thread,
          thread_id: 't-user-fork',
          title: '用户派生会话',
          parent_session_id: 's-parent',
        },
        {
          ...thread,
          thread_id: 't-delegated-child',
          title: '委派子任务会话',
          is_child_task: true,
          parent_session_id: 's-parent',
        },
      ],
    });

    await waitFor(() => expect(screen.getByText('用户派生会话')).toBeTruthy());
    expect(screen.getByText('父会话')).toBeTruthy();
    expect(screen.queryByText('委派子任务会话')).toBeNull();
  });
});
