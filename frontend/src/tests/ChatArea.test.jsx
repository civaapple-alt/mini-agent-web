import React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChatArea from '../components/ChatArea';

beforeEach(() => {
  const mockedHeight = (element) => {
    if (element.classList?.contains('chat-area')) return 600;
    if (element.classList?.contains('session-turn-rail')) return 240;
    if (element.closest?.('.session-turn-rail') && element.hasAttribute('data-index')) return 24;
    if (element.classList?.contains('virtual-message-row')) return 180;
    return 0;
  };
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function measureHeight() {
    return mockedHeight(this);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => 860);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function measureScrollHeight() {
    if (this.classList?.contains('chat-area')) {
      return Math.max(600, Number.parseFloat(this.querySelector('.messages-list')?.style.height || '0'));
    }
    if (this.classList?.contains('session-turn-rail')) {
      return Math.max(240, Number.parseFloat(this.firstElementChild?.style.height || '0'));
    }
    return 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function measureClientHeight() {
    if (this.classList?.contains('chat-area')) return 600;
    if (this.classList?.contains('session-turn-rail')) return 240;
    return mockedHeight(this);
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function measure() {
    const height = mockedHeight(this);
    const virtualOffset = this.classList?.contains('virtual-message-row')
      ? Number(this.style.transform.match(/translateY\(([-\d.]+)px\)/)?.[1] || 0)
      : 0;
    const top = this.classList?.contains('virtual-message-row')
      ? virtualOffset - (this.closest?.('.chat-area')?.scrollTop || 0)
      : 0;
    return {
      x: 0, y: top, top, left: 0, right: 860, bottom: top + height,
      width: 860, height, toJSON: () => ({}),
    };
  });
});

afterEach(() => vi.restoreAllMocks());

describe('ChatArea turn status', () => {
  it('labels a sub-second completed Turn without rounding it down to zero', () => {
    render(
      <ChatArea
        messages={[
          { id: 'short-turn-input', role: 'user', turnId: 'short-turn', text: 'quick task' },
          { id: 'short-turn-answer', role: 'assistant', turnId: 'short-turn', text: 'done' },
        ]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={{ status: 'completed', turnId: 'short-turn', durationMs: 420 }}
      />,
    );

    expect(screen.getByText('已处理不足1秒')).toBeTruthy();
  });

  it('keeps the measured duration after completion when persisted timestamps collapse to zero', () => {
    const turnId = 'settled-turn';
    const timestamp = 1_790_000_000_000;
    render(
      <ChatArea
        messages={[
          { id: 'settled-input', role: 'user', turnId, text: 'long request' },
          { id: 'settled-answer', role: 'assistant', turnId, text: 'done' },
        ]}
        threadItems={[
          { turnId, capturedAt: timestamp, item: { type: 'userMessage', id: 'settled-input', text: 'long request' } },
          { turnId, capturedAt: timestamp, item: { type: 'agentMessage', id: 'settled-answer', text: 'done' } },
        ]}
        traceScope={{ threadId: 'thread-a', projectId: 'project-a' }}
        turnTimings={new Map([['project-a:thread-a:settled-turn', {
          startedAtMs: timestamp,
          durationMs: 687_000,
        }]])}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={null}
      />,
    );

    expect(screen.getByText('已处理 11分钟27秒')).toBeTruthy();
  });

  it('shows the settled failure reason instead of a generic incomplete label', () => {
    render(
      <ChatArea
        messages={[]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={{
          status: 'failed',
          steps: 2,
          error: 'model request failed: transport error',
        }}
        onQuickPrompt={() => {}}
        onRetryPrompt={() => {}}
      />,
    );

    expect(screen.getByText('本轮执行失败')).toBeDefined();
    expect(screen.getByText(/原因：model request failed: transport error/)).toBeDefined();
    expect(screen.getByText(/重新发送此提示词.*不会续接已断开的请求/)).toBeDefined();
    expect(screen.queryByText('本轮未完整结束')).toBeNull();
  });

  it('offers the execution record entry when a tool result needs reconciliation', () => {
    const props = {
      messages: [],
      isGenerating: false,
      pendingApproval: null,
      lastTurnResult: {
        status: 'in_progress',
        turnId: 'turn-reconcile',
        error: 'process_restart_during_tool_call',
        recovery: {
          turn_id: 'turn-reconcile',
          status: 'needs_reconciliation',
          checkpoint_seq: 12,
          reason: 'process_restart_during_tool_call',
          uncertain_tool_calls: [
            { tool_call_id: 'call-1', name: 'shell' },
          ],
        },
      },
    };
    const { rerender } = render(<ChatArea {...props} />);

    expect(screen.getByText(/工具执行结果需要核对后才能继续/)).toBeTruthy();
    expect(screen.getByText(/还有 1 条调用待核对。执行检查点 12。/)).toBeTruthy();
    expect(screen.getByText(/App Server 在工具调用期间重启/)).toBeTruthy();
    expect(screen.queryByText('原因：process_restart_during_tool_call')).toBeNull();
    expect(screen.getByRole('button', { name: '查看待核对活动' })).toBeTruthy();
    expect(screen.getByLabelText('核对工具 shell')).toBeTruthy();
    expect(screen.queryByLabelText('核对依据（最多 1024 字节）')).toBeNull();

    rerender(
      <ChatArea
        {...props}
        lastTurnResult={{
          status: 'in_progress',
          turnId: 'turn-reconcile',
          error: 'process_restart_during_tool_call',
        }}
      />,
    );
    expect(screen.getByText(/当前工具调用结果可能未知/)).toBeTruthy();
  });

  it('submits successful, failed, and confirmed-not-executed tool outcomes', () => {
    const onReconcileExecution = vi.fn();
    render(
      <ChatArea
        messages={[]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={{
          status: 'in_progress',
          turnId: 'turn-reconcile',
          recovery: {
            status: 'needs_reconciliation',
            turnId: 'turn-reconcile',
            checkpointSeq: 7,
            uncertainToolCalls: [
              { toolCallId: 'call-1', name: 'send_message' },
            ],
          },
        }}
        onReconcileExecution={onReconcileExecution}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /已执行并成功/ }));
    fireEvent.change(screen.getByLabelText('核对依据（最多 1024 字节）'), {
      target: { value: 'verified at the destination' },
    });
    fireEvent.change(screen.getByLabelText('工具实际成功结果（最多 64 KiB）'), {
      target: { value: 'message receipt 123' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存成功结果' }));
    fireEvent.click(screen.getByRole('radio', { name: /已执行但失败/ }));
    fireEvent.change(screen.getByLabelText('工具实际失败输出（最多 64 KiB）'), {
      target: { value: 'permission denied' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存失败结果' }));
    fireEvent.click(screen.getByRole('radio', { name: /确认尚未执行/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存未执行确认' }));

    expect(onReconcileExecution).toHaveBeenNthCalledWith(
      1,
      'call-1',
      'completed',
      'message receipt 123',
      'verified at the destination',
      expect.any(String),
    );
    expect(onReconcileExecution).toHaveBeenNthCalledWith(
      2,
      'call-1',
      'failed',
      'permission denied',
      'verified at the destination',
      expect.any(String),
    );
    expect(onReconcileExecution).toHaveBeenNthCalledWith(
      3,
      'call-1',
      'not_executed',
      '',
      'verified at the destination',
      expect.any(String),
    );
  });

  it('clears the previous tool output when the reconciliation outcome changes', () => {
    render(
      <ChatArea
        messages={[]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={{
          status: 'in_progress',
          turnId: 'turn-reconcile',
          recovery: {
            status: 'needs_reconciliation',
            turnId: 'turn-reconcile',
            uncertainToolCalls: [
              { toolCallId: 'call-1', name: 'send_message' },
            ],
          },
        }}
        onReconcileExecution={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /已执行但失败/ }));
    fireEvent.change(screen.getByLabelText('核对依据（最多 1024 字节）'), {
      target: { value: 'checked the destination state' },
    });
    fireEvent.change(screen.getByLabelText('工具实际失败输出（最多 64 KiB）'), {
      target: { value: 'permission denied' },
    });

    fireEvent.click(screen.getByRole('radio', { name: /已执行并成功/ }));
    expect(screen.getByLabelText('工具实际成功结果（最多 64 KiB）').value).toBe('');
    expect(screen.getByLabelText('核对依据（最多 1024 字节）').value)
      .toBe('checked the destination state');

    fireEvent.click(screen.getByRole('radio', { name: /确认尚未执行/ }));
    expect(screen.queryByLabelText('工具实际成功结果（最多 64 KiB）')).toBeNull();
    expect(screen.getByText(/恢复时会重新运行这条工具调用/)).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /已执行但失败/ }));
    expect(screen.getByLabelText('工具实际失败输出（最多 64 KiB）').value).toBe('');
  });

  it('shows the saved checkpoint progress and resumes the same Turn on request', () => {
    const onResumeExecution = vi.fn();
    render(
      <ChatArea
        messages={[]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={{
          status: 'in_progress',
          turnId: 'turn-recovery',
          recovery: {
            status: 'waiting_for_continue',
            checkpoint_seq: 14,
            phase: 'tool_batch',
            last_progress_ms: new Date(2026, 0, 2, 3, 4, 5).getTime(),
          },
        }}
        onResumeExecution={onResumeExecution}
      />,
    );

    expect(screen.getByText(/阶段：工具批次/)).toBeTruthy();
    expect(screen.getByText(/最近进展/)).toBeTruthy();
    expect(screen.getByText(/执行检查点 14 已保存/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '继续当前 Turn' }));
    expect(onResumeExecution).toHaveBeenCalledTimes(1);
  });

  it('hides a previous incomplete result while a steer continuation is active', () => {
    const baseProps = {
      messages: [{
        id: 'steer-1',
        role: 'user',
        text: '继续核对',
        isSteer: true,
        steerTurnId: 'turn-1',
      }],
      pendingApproval: null,
      lastTurnResult: {
        status: 'step_limit',
        steps: 6,
        turnId: 'turn-1',
      },
      onQuickPrompt: () => {},
      onRetryPrompt: () => {},
    };
    const { rerender } = render(<ChatArea {...baseProps} isGenerating />);

    expect(screen.queryByText('本轮达到运行步数上限')).toBeNull();

    rerender(<ChatArea {...baseProps} isGenerating={false} />);
    expect(screen.getByText('本轮达到运行步数上限')).toBeTruthy();
    expect(screen.getByText(/已执行 6 步/)).toBeTruthy();
  });

  it('hides an incomplete result while runtime status says the Turn is active', () => {
    render(
      <ChatArea
        messages={[]}
        isGenerating={false}
        pendingApproval={null}
        statusModel={{ lifecycle: 'running', process: { turnActive: true } }}
        lastTurnResult={{ status: 'failed', turnId: 'turn-2', error: 'old failure' }}
        onQuickPrompt={() => {}}
        onRetryPrompt={() => {}}
      />,
    );

    expect(screen.queryByText('本轮执行失败')).toBeNull();
  });

  it('does not show the incomplete banner for an unknown or steer-transition status', () => {
    const { rerender } = render(
      <ChatArea
        messages={[]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={{ status: 'unknown' }}
      />,
    );

    expect(screen.queryByText('本轮状态未知')).toBeNull();
    rerender(
      <ChatArea
        messages={[]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={{ status: 'steered' }}
      />,
    );
    expect(screen.queryByText('本轮未完整结束')).toBeNull();
  });
});

describe('ChatArea history virtualization', () => {
  const makeHistory = (count) => Array.from({ length: count }, (_, index) => ({
    id: `history-input-${index}`,
    role: 'user',
    turnId: `history-turn-${index}`,
    text: `history prompt ${index}`,
  }));

  it('keeps mounted timeline and Turn navigation nodes bounded by the viewport range', () => {
    const { container } = render(
      <ChatArea
        messages={makeHistory(300)}
        isGenerating={false}
        pendingApproval={null}
      />,
    );

    const timelineRows = container.querySelectorAll('[data-virtual-message-row]');
    const turnNodes = container.querySelectorAll('.session-turn-node');
    expect(timelineRows.length).toBeGreaterThan(0);
    expect(timelineRows.length).toBeLessThan(300);
    expect(turnNodes.length).toBeGreaterThan(0);
    expect(turnNodes.length).toBeLessThan(300);
  });

  it('virtualizes an unmounted Turn when selected from the rail', async () => {
    const { container } = render(
      <ChatArea
        messages={makeHistory(80)}
        isGenerating={false}
        pendingApproval={null}
      />,
    );
    const rail = container.querySelector('.session-turn-rail');
    rail.scrollTop = 40 * 24;
    fireEvent.scroll(rail);
    const target = await screen.findByRole('button', { name: /history prompt 40/ });
    const scroller = container.querySelector('.chat-area');
    scroller.scrollTo = ({ top = 0 }) => {
      scroller.scrollTop = top;
      fireEvent.scroll(scroller);
    };

    fireEvent.click(target);

    await waitFor(() => {
      expect(container.querySelector('[data-history-message-id="history-input-40"]')).toBeTruthy();
      expect(target.classList.contains('is-focused')).toBe(true);
    });
  });

  it('keeps the first visible message at the same screen offset when older history is prepended', async () => {
    const messages = makeHistory(60);
    const onLoadOlderHistory = vi.fn();
    const props = {
      messages,
      isGenerating: false,
      pendingApproval: null,
      olderHistoryAvailable: true,
      historyPageVersion: 0,
      onLoadOlderHistory,
    };
    const { container, rerender } = render(<ChatArea {...props} />);
    const scroller = container.querySelector('.chat-area');
    let scrollTop = scroller.scrollTop;
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value) => { scrollTop = value; },
    });
    scroller.scrollTo = ({ top = 0 }) => {
      scroller.scrollTop = top;
      window.requestAnimationFrame(() => fireEvent.scroll(scroller));
    };
    for (const top of [5000, 3000, 1000, 200]) {
      await act(async () => {
        scroller.scrollTop = top;
        fireEvent.scroll(scroller);
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
      });
    }
    const viewport = scroller.getBoundingClientRect();
    await act(async () => {
      scroller.scrollTop = 80;
      fireEvent.scroll(scroller);
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
    expect(onLoadOlderHistory).toHaveBeenCalledTimes(1);
    const anchor = [...container.querySelectorAll('[data-virtual-message-row]')].find((row) => {
      const bounds = row.getBoundingClientRect();
      return bounds.top < viewport.bottom && bounds.bottom > viewport.top;
    });
    const anchorId = anchor.dataset.historyMessageId;
    const originalOffset = anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    rerender(
      <ChatArea
        {...props}
        messages={[...makeHistory(20).map((message) => ({
          ...message,
          id: message.id.replace('history-input-', 'older-input-'),
          turnId: message.turnId.replace('history-turn-', 'older-turn-'),
        })), ...messages]}
        historyPageVersion={1}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
    });
    await waitFor(() => {
      const restored = container.querySelector(`[data-history-message-id="${anchorId}"]`);
      expect(restored).toBeTruthy();
      expect(restored.getBoundingClientRect().top - scroller.getBoundingClientRect().top)
        .toBe(originalOffset);
    });
  });
});

describe('ChatArea restored assistant replies', () => {
  it('shows reply actions only on the last assistant segment of each Turn', () => {
    const { container } = render(
      <ChatArea
        messages={[
          {
            id: 'turn-two-answer',
            role: 'assistant',
            turnId: 'turn-2',
            blocks: [{ type: 'text', id: 'answer-2', content: 'Earlier answer' }],
          },
          {
            id: 'turn-five-progress',
            role: 'assistant',
            turnId: 'turn-5',
            blocks: [{ type: 'text', id: 'progress-5', content: 'Now the new section at the end of the file.' }],
          },
          {
            id: 'turn-five-follow-up',
            role: 'assistant',
            turnId: 'turn-5',
            blocks: [{ type: 'tool', id: 'tool-5', name: 'apply_patch', status: 'completed' }],
          },
          {
            id: 'turn-five-answer',
            role: 'assistant',
            turnId: 'turn-5',
            blocks: [{ type: 'text', id: 'answer-5', content: 'The work is complete.' }],
          },
        ]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={null}
        onQuickPrompt={() => {}}
        onRetryPrompt={() => {}}
      />,
    );

    const footerMessageIds = [...container.querySelectorAll('.assistant-footer')]
      .map((footer) => footer.closest('.message-row')?.getAttribute('data-message-id'));
    expect(footerMessageIds).toEqual(['turn-two-answer', 'turn-five-answer']);
  });

  it('keeps the live execution segment expanded until the next segment begins', () => {
    const { container, rerender } = render(
      <ChatArea
        messages={[{
          id: 'assistant-live',
          role: 'assistant',
          turnId: 'turn-live',
          blocks: [
            { type: 'thinking', id: 'thinking-one', content: 'previous reasoning' },
            { type: 'tool', id: 'tool-one', name: 'read_file', status: 'completed' },
          ],
        }]}
        statusModel={{ scope: { turnId: 'turn-live' }, lifecycle: 'running' }}
        isGenerating
        pendingApproval={null}
        lastTurnResult={null}
      />,
    );

    expect(container.querySelector('.thinking-body')?.textContent).toContain('previous reasoning');
    expect(container.querySelector('.assistant-activity-group')).toBeNull();

    rerender(
      <ChatArea
        messages={[{
          id: 'assistant-live',
          role: 'assistant',
          turnId: 'turn-live',
          blocks: [
            { type: 'thinking', id: 'thinking-one', content: 'previous reasoning' },
            { type: 'tool', id: 'tool-one', name: 'read_file', status: 'completed' },
            { type: 'thinking', id: 'thinking-two', content: 'current reasoning' },
          ],
        }]}
        statusModel={{ scope: { turnId: 'turn-live' }, lifecycle: 'running' }}
        isGenerating
        pendingApproval={null}
        lastTurnResult={null}
      />,
    );

    expect(screen.getByRole('button', { name: /已完成 2 项活动/ })).toBeTruthy();
    expect(container.querySelectorAll('.thinking-body')).toHaveLength(1);
    expect(container.querySelector('.thinking-body')?.textContent).toContain('current reasoning');
    expect(screen.queryByText('previous reasoning')).toBeNull();
  });

  it('keeps the final settled segment available while earlier work stays summarized', () => {
    const { container } = render(
      <ChatArea
        messages={[{
          id: 'assistant-restored',
          role: 'assistant',
          turnId: 'turn-restored',
          blocks: [
            { type: 'thinking', id: 'restored-thinking-one', content: 'earlier reasoning' },
            { type: 'tool', id: 'restored-tool-one', name: 'read_file', status: 'completed' },
            { type: 'thinking', id: 'restored-thinking-two', content: 'final segment reasoning' },
            { type: 'tool', id: 'restored-tool-two', name: 'apply_patch', status: 'completed' },
            { type: 'text', id: 'restored-final', content: 'final response' },
          ],
        }]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={null}
      />,
    );

    expect(screen.getByRole('button', { name: /已完成 2 项活动/ })).toBeTruthy();
    expect(container.querySelectorAll('.thinking-body')).toHaveLength(1);
    expect(container.querySelector('.thinking-body')?.textContent)
      .toContain('final segment reasoning');
    expect(screen.queryByText('earlier reasoning')).toBeNull();
    expect(screen.getByText('final response')).toBeTruthy();
  });

  it('compresses earlier restored assistant segments and keeps the last segment expandable', () => {
    const { container } = render(
      <ChatArea
        messages={[
          { id: 'turn-input', role: 'user', turnId: 'turn-segments', text: 'inspect and update' },
          {
            id: 'segment-one',
            role: 'assistant',
            turnId: 'turn-segments',
            blocks: [
              { type: 'thinking', id: 'segment-one-thinking', content: 'earlier segment' },
              { type: 'tool', id: 'segment-one-tool', name: 'read_file', status: 'completed' },
            ],
          },
          {
            id: 'segment-two',
            role: 'assistant',
            turnId: 'turn-segments',
            blocks: [
              { type: 'thinking', id: 'segment-two-thinking', content: 'last segment' },
              { type: 'tool', id: 'segment-two-tool', name: 'apply_patch', status: 'completed' },
              { type: 'text', id: 'segment-two-answer', content: 'final answer' },
            ],
          },
        ]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={null}
      />,
    );

    expect(container.querySelectorAll('.assistant-activity-group-summary')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /已完成 2 次模型调用/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /已完成 2 次模型调用/ }));
    fireEvent.click(screen.getByRole('button', { name: /模型调用 2/ }));
    fireEvent.click(container.querySelector('.thinking-header'));
    expect(container.querySelectorAll('.thinking-body')).toHaveLength(1);
    expect(container.querySelector('.thinking-body')?.textContent).toContain('last segment');
    expect(screen.queryByText('earlier segment')).toBeNull();
    expect(screen.getByText('final answer')).toBeTruthy();
  });
});

describe('ChatArea delegated child task batch', () => {
  const messages = [{
    id: 'assistant-turn-4',
    role: 'assistant',
    turnId: 'turn-4',
    blocks: [
      {
        type: 'tool',
        id: 'delegate-1',
        name: 'delegate_task',
        args: { child_key: 'child-a', title: 'Trace event ordering', execution_mode: 'parallel' },
        output: { child_thread_id: 'child-a', operation_id: 'op-a' },
        status: 'completed',
      },
      {
        type: 'tool',
        id: 'delegate-2',
        name: 'delegate_task',
        args: { child_key: 'child-b', title: 'Check session replay', execution_mode: 'parallel' },
        output: { child_thread_id: 'child-b', operation_id: 'op-b' },
        status: 'completed',
      },
    ],
  }];

  const queuedTasks = [
    {
      operation_id: 'op-a',
      child_thread_id: 'child-a',
      parent_turn_id: 'turn-4',
      title: 'Trace event ordering',
      execution_mode: 'parallel',
      status: 'queued',
      waiting_reason: '等待并发槽位',
      reports: [{ text: '先检查事件排序', timestamp_ms: 1_700_000_000_100 }],
      lifecycle: [{ status: 'queued', timestamp_ms: 1_700_000_000_000, attempt: 1 }],
      child_session_available: true,
    },
    {
      operation_id: 'op-b',
      child_thread_id: 'child-b',
      parent_turn_id: 'turn-4',
      title: 'Check session replay',
      execution_mode: 'parallel',
      status: 'running',
      lifecycle: [
        { status: 'queued', timestamp_ms: 1_700_000_000_000, attempt: 1 },
        { status: 'running', timestamp_ms: 1_700_000_001_000, attempt: 1 },
      ],
      started_at_ms: 1_700_000_001_000,
      child_session_available: true,
    },
  ];

  const renderArea = (childTasks) => (
    <ChatArea
      messages={messages}
      childTasks={childTasks}
      isGenerating={false}
      pendingApproval={null}
      lastTurnResult={null}
      onQuickPrompt={() => {}}
      onRetryPrompt={() => {}}
    />
  );

  it('renders one ordered batch card with each child name and lifecycle', () => {
    const { container } = render(renderArea(queuedTasks));

    expect(screen.getAllByLabelText('子代理任务批次')).toHaveLength(1);
    expect([...container.querySelectorAll('.delegate-task-heading strong')].map((node) => node.textContent))
      .toEqual(['Trace event ordering', 'Check session replay']);
    expect(screen.getAllByText('已分配').length).toBeGreaterThan(0);
    expect(screen.getByText('已开始')).toBeTruthy();
    expect(screen.getByText('排队中')).toBeTruthy();
    expect(screen.getByText('运行中')).toBeTruthy();
    expect(screen.getByText('等待并发槽位')).toBeTruthy();
    expect(screen.getByText('先检查事件排序')).toBeTruthy();
  });

  it('updates the replayed batch as child lifecycle reaches a terminal state', () => {
    const { rerender } = render(renderArea(queuedTasks));
    const completedTasks = [
      {
        ...queuedTasks[0],
        status: 'completed',
        duration_ms: 2_400,
        started_at_ms: 1_700_000_001_000,
        finished_at_ms: 1_700_000_003_400,
        lifecycle: [
          ...queuedTasks[0].lifecycle,
          { status: 'running', timestamp_ms: 1_700_000_001_000, attempt: 1 },
          { status: 'completed', timestamp_ms: 1_700_000_003_400, attempt: 1 },
        ],
      },
      {
        ...queuedTasks[1],
        status: 'failed',
        duration_ms: 1_800,
        finished_at_ms: 1_700_000_002_800,
        lifecycle: [
          ...queuedTasks[1].lifecycle,
          { status: 'failed', timestamp_ms: 1_700_000_002_800, attempt: 1 },
        ],
      },
    ];
    rerender(renderArea(completedTasks));

    expect(screen.getByText('已完成 · 2.4s')).toBeTruthy();
    expect(screen.getByText('失败 · 1.8s')).toBeTruthy();
    expect(screen.getAllByText('失败').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('子代理任务批次')).toHaveLength(1);
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
  });

  it('keeps a message without a Turn ID from absorbing unrelated child tasks', () => {
    render(
      <ChatArea
        messages={[{
          id: 'legacy-message',
          role: 'assistant',
          blocks: [{
            type: 'tool',
            id: 'delegate-a',
            name: 'delegate_task',
            args: { child_thread_id: 'child-a', title: 'Trace event ordering' },
            status: 'completed',
          }],
        }]}
        childTasks={[
          { child_thread_id: 'child-a', title: 'Trace event ordering', status: 'completed' },
          { child_thread_id: 'child-b', title: 'Unrelated child task', status: 'running' },
        ]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={null}
        onQuickPrompt={() => {}}
        onRetryPrompt={() => {}}
      />,
    );

    expect(screen.getAllByLabelText('子代理任务批次')).toHaveLength(1);
    expect(screen.getByText('Trace event ordering')).toBeTruthy();
    expect(screen.queryByText('Unrelated child task')).toBeNull();
  });
});
