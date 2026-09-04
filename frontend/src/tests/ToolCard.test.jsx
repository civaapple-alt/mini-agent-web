import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ToolCard from '../components/ToolCard';
import ErrorBoundary from '../components/ErrorBoundary';

describe('ToolCard Component Rendering & Interaction', () => {
  it('renders completed tool call with name and output correctly', () => {
    const tool = {
      id: 'tool_1',
      name: 'run_command',
      arguments: { command: 'git status' },
      status: 'completed',
      output: 'On branch main\nnothing to commit',
    };

    render(<ToolCard tool={tool} />);

    expect(screen.getByText('run_command')).toBeDefined();
    expect(screen.getByText('git status')).toBeDefined();
    expect(screen.getByText('已完成')).toBeDefined();

    // Expand output
    const toggleBtn = screen.getByText('执行输出 (Output)');
    fireEvent.click(toggleBtn);
    expect(screen.getByText(/On branch main/)).toBeDefined();
  });

  it('renders running tool state without throwing', () => {
    const tool = {
      id: 'tool_2',
      name: 'read_file',
      arguments: { path: 'src/App.jsx' },
      status: 'running',
    };

    render(<ToolCard tool={tool} />);

    expect(screen.getByText('read_file')).toBeDefined();
    expect(screen.getByText('src/App.jsx')).toBeDefined();
    expect(screen.getByText('运行中')).toBeDefined();
  });

  it('renders failed tool state with error message', () => {
    const tool = {
      id: 'tool_3',
      name: 'shell',
      arguments: { command: 'exit 1' },
      status: 'failed',
      error: 'Command failed with exit code 1',
    };

    render(<ToolCard tool={tool} />);

    expect(screen.getByText('失败')).toBeDefined();

    // Expand output
    const toggleBtn = screen.getByText('执行输出 (Output)');
    fireEvent.click(toggleBtn);
    expect(screen.getByText('Command failed with exit code 1')).toBeDefined();
  });

  it('renders awaiting-approval state and triggers onRespondApproval on approve/deny', () => {
    const tool = {
      id: 'call_99',
      name: 'shell',
      arguments: { command: 'rm -rf /tmp/test' },
      status: 'running',
    };
    const pendingApproval = {
      requestId: 'req_123',
      data: {
        callId: 'call_99',
        toolName: 'shell',
        actionSummary: '删除临时文件',
      },
    };
    const onRespondApproval = vi.fn();

    render(
      <ToolCard
        tool={tool}
        pendingApproval={pendingApproval}
        onRespondApproval={onRespondApproval}
        approvalMode="current_project"
      />
    );

    expect(screen.getByText('等待授权')).toBeDefined();
    expect(screen.getByText('安全权限审批 (Security Approval)')).toBeDefined();
    expect(screen.getByText('删除临时文件')).toBeDefined();

    // Verify CheckCheck icon renders inside current project button
    expect(screen.getByText('当前项目复用')).toBeDefined();

    // Click Allow
    const allowBtn = screen.getByText('允许一次 (Allow)');
    fireEvent.click(allowBtn);
    expect(onRespondApproval).toHaveBeenCalledWith('req_123', 'approve', '', 'per_action');

    // Click Deny to open input
    const denyBtn = screen.getByText('拒绝 (Deny)');
    fireEvent.click(denyBtn);
    expect(screen.getByPlaceholderText('输入拒绝原因 (可选，回车确认)...')).toBeDefined();

    // Enter reason and confirm
    const input = screen.getByPlaceholderText('输入拒绝原因 (可选，回车确认)...');
    fireEvent.change(input, { target: { value: '不安全' } });
    const confirmDenyBtn = screen.getByText('确认拒绝');
    fireEvent.click(confirmDenyBtn);
    expect(onRespondApproval).toHaveBeenCalledWith('req_123', 'deny', '不安全', 'current_project');
  });
});

describe('ErrorBoundary Component Protection', () => {
  function BuggyComponent({ shouldThrow }) {
    if (shouldThrow) {
      throw new Error('故意触发的渲染异常 (Intentional render failure)');
    }
    return <div>正常组件内容</div>;
  }

  it('catches render errors and displays fallback UI without crashing', () => {
    // Suppress console.error in test output for intentional error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary title="测试工具渲染异常">
        <BuggyComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('测试工具渲染异常')).toBeDefined();
    expect(screen.getByText('故意触发的渲染异常 (Intentional render failure)')).toBeDefined();
    expect(screen.getByText('重试')).toBeDefined();

    spy.mockRestore();
  });
});
