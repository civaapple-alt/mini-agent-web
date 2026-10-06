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
    expect(screen.queryByText('执行输出')).toBeNull();

    // Expand parameters and output.
    const toggleBtn = screen.getByText('查看详情');
    fireEvent.click(toggleBtn);
    expect(screen.getByText('工具参数')).toBeDefined();
    expect(screen.getByText('执行输出')).toBeDefined();
    expect(screen.getByText(/On branch main/)).toBeDefined();
  });

  it('hides opaque web result handles and cursors from arguments and output', () => {
    render(
      <ToolCard
        tool={{
          id: 'fetch-continuation',
          name: 'web_fetch',
          arguments: { handle: 'opaque-result-handle', cursor: '8192' },
          status: 'completed',
          output: JSON.stringify({
            kind: 'web_fetch',
            url: 'https://example.com/long',
            content: 'continued page text',
            handle: 'opaque-result-handle',
            nextCursor: '16384',
          }),
        }}
      />,
    );

    expect(screen.getByText('继续读取网页正文')).toBeDefined();
    expect(screen.queryByText(/opaque-result-handle|8192|16384/)).toBeNull();
    fireEvent.click(screen.getByText('查看详情'));
    expect(screen.getByText(/continued page text/)).toBeDefined();
    expect(screen.queryByText(/opaque-result-handle|8192|16384/)).toBeNull();
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
    expect(screen.getByText('查看详情')).toBeDefined();
    fireEvent.click(screen.getByText('查看详情'));
    expect(screen.getByText('等待工具执行结果...')).toBeDefined();
  });

  it('shows a recommended ask_user option and submits only after the user selects it', async () => {
    const respond = vi.fn().mockResolvedValue({ accepted: true });
    render(
      <ToolCard
        tool={{ id: 'call-1', name: 'ask_user', status: 'running' }}
        pendingUserQuestion={{
          interactionId: 'uq-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          callId: 'call-1',
          currentIndex: 0,
          answers: [null],
          questions: [{
            id: 'q1',
            prompt: 'How should we proceed?',
            allowFreeText: true,
            allowSkip: true,
            options: [{
              id: 'q1-o1',
              label: 'Use the scoped approach',
              recommended: true,
              recommendationReason: 'It matches the requested behavior.',
            }],
          }],
        }}
        onRespondUserQuestion={respond}
      />,
    );

    expect(screen.getByText('推荐')).toBeDefined();
    expect(screen.getByText(/推荐理由：It matches/)).toBeDefined();
    expect(respond).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Use the scoped approach/ }));
    expect(respond).toHaveBeenCalledWith({
      interaction: expect.objectContaining({ interactionId: 'uq-1' }),
      questionId: 'q1',
      answer: { type: 'option', optionId: 'q1-o1' },
    });
  });

  it('keeps completed ask_user history collapsed until expanded', () => {
    render(
      <ToolCard
        tool={{
          id: 'call-2',
          name: 'ask_user',
          status: 'completed',
          arguments: { questions: [{ question: 'Choose a mode' }] },
          output: JSON.stringify({ answers: [{ questionId: 'q1', question: 'Choose a mode', answer: { type: 'text', text: 'fast' }, answerLabel: 'fast' }] }),
        }}
      />,
    );

    expect(screen.getByText('已询问 1 个问题')).toBeDefined();
    expect(screen.queryByText('fast')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /已询问 1 个问题/ }));
    expect(screen.getByText('fast')).toBeDefined();
  });

  it('submits a free-text answer on Enter', () => {
    const respond = vi.fn().mockResolvedValue({ accepted: true });
    render(
      <ToolCard
        tool={{ id: 'call-3', name: 'ask_user', status: 'running' }}
        pendingUserQuestion={{
          interactionId: 'uq-3',
          threadId: 'thread-1',
          turnId: 'turn-1',
          callId: 'call-3',
          currentIndex: 0,
          answers: [null],
          questions: [{ id: 'q1', prompt: 'Anything else?', options: [], allowFreeText: true, allowSkip: true }],
        }}
        onRespondUserQuestion={respond}
      />
    );
    const input = screen.getByLabelText('输入自己的回答');
    fireEvent.change(input, { target: { value: 'Keep it short' } });
    fireEvent.submit(input.closest('form'));
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({
      questionId: 'q1',
      answer: { type: 'text', text: 'Keep it short' },
    }));
  });

  it('shows a completed partial read_file result and its line range', () => {
    render(
      <ToolCard
        tool={{
          id: 'read-file-page',
          name: 'read_file',
          arguments: { path: 'scripts/car_model.py', offset: 40, limit: 12 },
          status: 'completed',
          output: '--- file: scripts/car_model.py | total_lines=240 | offset=40 | limit=12 ---\n41: page content\n[page boundary: next_offset=52; call read_file with the same path and this offset]',
        }}
      />,
    );

    expect(screen.getByText('scripts/car_model.py · 第 41-52 行')).toBeDefined();
    expect(screen.queryByText(/41: page content/)).toBeNull();
    expect(screen.queryByText(/next_offset=52/)).toBeNull();

    fireEvent.click(screen.getByText('查看详情'));
    expect(screen.getByText(/41: page content/)).toBeDefined();
    expect(screen.getByText(/next_offset=52/)).toBeDefined();
  });

  it('opens complete tool parameters and output on demand instead of on hover', () => {
    const command = 'Add-Type -AssemblyName System.Drawing\n$source = \'D:/workspace/assets/reference-image.jpg\'\n$image = [System.Drawing.Image]::FromFile($source)';
    const { container } = render(
      <ToolCard
        tool={{
          id: 'long-command',
          name: 'shell',
          arguments: { command },
          status: 'completed',
          output: 'done',
        }}
      />,
    );

    const snippet = container.querySelector('.tool-args-snippet');
    expect(snippet).not.toBeNull();
    fireEvent.mouseEnter(snippet);
    expect(container.querySelector('.tool-details-panel')).toBeNull();

    fireEvent.click(screen.getByText('查看详情'));
    expect(
      container.querySelector('.tool-detail-section[aria-label="工具参数"] pre')?.textContent,
    ).toBe(JSON.stringify({ command }, null, 2));
    expect(screen.getByText('执行输出')).toBeDefined();
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

    // Expand parameters and output.
    const toggleBtn = screen.getByText('查看详情');
    fireEvent.click(toggleBtn);
    expect(screen.getByText('Command failed with exit code 1')).toBeDefined();
  });

  it.each([
    ['completed', '已完成'],
    ['failed', '失败'],
    ['needs_approval', '等待授权'],
    ['deferred', '暂缓执行'],
    ['retryable', '可重试'],
  ])('renders structured %s outcome', (outcome, label) => {
    render(
      <ToolCard
        tool={{ id: `outcome-${outcome}`, name: 'shell', status: 'failed', outcome }}
      />,
    );

    expect(screen.getByText(label)).toBeDefined();
  });

  it('renders an unknown outcome without changing it to a generic failure', () => {
    render(
      <ToolCard
        tool={{ id: 'outcome-unknown', name: 'shell', status: 'failed', outcome: 'server_added_state' }}
      />,
    );

    expect(screen.getByText('未知状态 (server_added_state)')).toBeDefined();
  });

  it('renders awaiting-approval state without a second approval action area', () => {
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
        allowedGrantScopes: ['once', 'project'],
      },
    };
    render(
      <ToolCard
        tool={tool}
        pendingApproval={pendingApproval}
        policy="interactive"
      />
    );

    expect(screen.getByText('等待授权')).toBeDefined();
    expect(screen.queryByText('安全权限审批 (Security Approval)')).toBeNull();
    expect(screen.queryByText('允许一次 (Allow)')).toBeNull();
    expect(screen.queryByText('拒绝 (Deny)')).toBeNull();
  });

  it('does not mark another same-name tool as awaiting approval', () => {
    const pendingApproval = {
      requestId: 'req_123',
      data: { callId: 'call_99', toolName: 'shell' },
    };
    render(
      <>
        <ToolCard
          tool={{ id: 'call_99', name: 'shell', status: 'running' }}
          pendingApproval={pendingApproval}
        />
        <ToolCard
          tool={{ id: 'call_100', name: 'shell', status: 'running' }}
          pendingApproval={pendingApproval}
        />
      </>,
    );

    expect(screen.getByText('等待授权')).toBeDefined();
    expect(screen.getAllByText('运行中')).toHaveLength(1);
  });

  it('renders the settled approval result in the tool message', () => {
    render(
      <ToolCard
        tool={{
          id: 'call_approval-result',
          name: 'shell',
          status: 'completed',
          approval: {
            state: 'denied',
            reason: '用户拒绝执行',
          },
        }}
      />,
    );

    expect(screen.getByText(/用户已拒绝执行 · 用户拒绝执行/)).toBeDefined();
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
