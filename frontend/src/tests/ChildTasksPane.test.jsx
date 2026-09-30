import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChildTasksPane from '../components/ChildTasksPane';

describe('ChildTasksPane', () => {
  it('counts a saved execution checkpoint as attention and exposes one continue action', async () => {
    const onControl = vi.fn().mockResolvedValue({ outcome: { outcome: 'applied' } });
    const { container } = render(
      <ChildTasksPane
        children={[{
          operation_id: 'operation-recovery',
          child_thread_id: 'child-recovery',
          title: 'Recover long task',
          status: 'running',
          operation_attempt: 1,
          execution_recovery: {
            turn_id: 'turn-recovery',
            checkpoint_seq: 9,
            status: 'waiting_for_continue',
            reason: '采样停滞',
          },
        }]}
        loading={false}
        error={null}
        onControl={onControl}
      />,
    );

    expect(container.querySelector('.child-task-count').getAttribute('aria-label'))
      .toBe('运行 0，排队 0，待处理 1，已结束 0，共 1');
    expect(screen.getByText('停滞待继续')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    await waitFor(() => expect(onControl).toHaveBeenCalledWith(
      expect.objectContaining({ child_thread_id: 'child-recovery' }),
      'resume',
      { requestId: 'child-turn-resume:turn-recovery:9' },
    ));
    expect(container.querySelector('.child-task-actions')).toBeNull();
  });

  it('shows child lifecycle and diagnostics but does not open a child without a Session', () => {
    render(
      <ChildTasksPane
        projectId="memory-card"
        onOpenThread={vi.fn()}
        children={[
          {
            operation_id: 'operation-failed',
            child_thread_id: 'child-missing',
            title: 'Frontend size estimate',
            status: 'failed',
            child_session_available: false,
            operation_error: 'child Session creation failed',
            lifecycle: [
              { status: 'queued', timestamp_ms: 1_700_000_000_000, attempt: 1 },
              { status: 'failed', timestamp_ms: 1_700_000_002_000, attempt: 1 },
            ],
          },
        ]}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('Frontend size estimate')).toBeTruthy();
    expect(screen.getByText('child Session creation failed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /展开任务详情：Frontend size estimate/ }));
    expect(screen.getByText('模式未知')).toBeTruthy();
    expect(screen.getByText('已分配')).toBeTruthy();
    expect(screen.getAllByText('失败').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '打开' })).toBeNull();
  });

  it('opens a child Session when the projection says it exists', () => {
    const onOpenThread = vi.fn();
    const { container } = render(
      <ChildTasksPane
        projectId="memory-card"
        onOpenThread={onOpenThread}
        children={[
          {
            operation_id: 'operation-a',
            child_thread_id: 'child-a',
            title: 'Check App Server events',
            status: 'completed',
            execution_mode: 'parallel',
            child_session_available: true,
            duration_ms: 2_400,
            lifecycle: [
              { status: 'queued', timestamp_ms: 1_700_000_000_000, attempt: 1 },
              { status: 'running', timestamp_ms: 1_700_000_001_000, attempt: 1 },
              { status: 'completed', timestamp_ms: 1_700_000_002_400, attempt: 1 },
            ],
          },
        ]}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '显示已结束任务（1）' }));
    fireEvent.click(screen.getByRole('button', { name: '查看' }));
    expect(onOpenThread).toHaveBeenCalledWith('child-a', 'memory-card');
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
    expect(container.querySelector('.child-task-duration').textContent).toContain('2.4s');
  });

  it('shows a bounded result preview for the completed attempt and opens its child Session', () => {
    const onOpenThread = vi.fn();
    const { container } = render(
      <ChildTasksPane
        projectId="memory-card"
        onOpenThread={onOpenThread}
        children={[
          {
            operation_id: 'operation-completed',
            child_thread_id: 'child-completed',
            title: 'Completed review',
            status: 'completed',
            operation_attempt: 2,
            child_session_available: true,
            operation_result: '结论'.repeat(150),
            lifecycle: [
              { status: 'queued', attempt: 1 },
              { status: 'failed', attempt: 1 },
              { status: 'queued', attempt: 2, attempt_kind: 'retry' },
              { status: 'completed', attempt: 2, attempt_kind: 'retry' },
            ],
          },
          {
            operation_id: 'operation-running',
            child_thread_id: 'child-running',
            title: 'Running retry',
            status: 'running',
            operation_attempt: 2,
            operation_result: '旧 attempt 的结果',
          },
        ]}
        loading={false}
        error={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '显示已结束任务（1）' }));
    const completedRow = [...container.querySelectorAll('.child-task-row')]
      .find((row) => row.textContent.includes('Completed review'));
    fireEvent.click(completedRow.querySelector('.child-task-summary'));

    const preview = completedRow.querySelector('.child-task-result');
    expect(preview.getAttribute('aria-label')).toBe('本轮最终结果预览');
    expect(Array.from(preview.querySelectorAll('span')[1].textContent)).toHaveLength(241);
    expect(preview.textContent).toContain('预览已截断');
    expect(completedRow.querySelector('.child-task-meta').textContent).toContain('重试 · 第 2 轮');
    fireEvent.click(screen.getByRole('button', { name: '查看结果' }));
    expect(onOpenThread).toHaveBeenCalledWith('child-completed', 'memory-card');

    const runningRow = [...container.querySelectorAll('.child-task-row')]
      .find((row) => row.textContent.includes('Running retry'));
    fireEvent.click(runningRow.querySelector('.child-task-summary'));
    expect(runningRow.querySelector('.child-task-result')).toBeNull();
  });

  it('prioritizes running work over queued work and shows the current report', () => {
    const { container } = render(
      <ChildTasksPane
        children={[
          { operation_id: 'done', title: 'Finished task', status: 'completed' },
          {
            operation_id: 'queued',
            title: 'Waiting task',
            status: 'queued',
            waiting_reason: '等待上一顺序步骤成功',
            reports: [{
              cursor: 7,
              report_id: 'report-7',
              attempt: 1,
              report: '已完成文件盘点',
              timestamp_ms: 1_700_000_000_000,
            }],
            next_cursor: 7,
          },
          { operation_id: 'running', title: 'Active task', status: 'running' },
        ]}
        loading={false}
        error={null}
      />,
    );

    expect([...container.querySelectorAll('.child-task-row .child-task-summary strong')]
      .map((node) => node.textContent)).toEqual(['Active task', 'Waiting task']);
    const queuedRow = [...container.querySelectorAll('.child-task-row')]
      .find((row) => row.textContent.includes('Waiting task'));
    fireEvent.click(queuedRow.querySelector('.child-task-summary'));
    expect(screen.getByText('等待：')).toBeTruthy();
    expect(screen.getAllByText('等待上一顺序步骤成功').length).toBeGreaterThan(0);
    expect(screen.getByText('已完成文件盘点')).toBeTruthy();
    expect(screen.getByRole('button', { name: '显示已结束任务（1）' })).toBeTruthy();
    expect(screen.queryByText('Finished task')).toBeNull();
  });

  it('shows a rejected start reason for queued and cancelled children', () => {
    render(
      <ChildTasksPane
        children={[
          {
            operation_id: 'queued-rejected',
            title: 'Queued start rejected',
            status: 'queued',
            operation_error: 'App Server rejected the child start',
          },
          {
            operation_id: 'cancelled-rejected',
            title: 'Cancelled start rejected',
            status: 'cancelled',
            operation_error: 'The queued operation was cancelled after rejection',
          },
        ]}
        loading={false}
        error={null}
      />,
    );

    expect(screen.getByText('App Server rejected the child start')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '显示已结束任务（1）' }));
    expect(
      screen.getByText('The queued operation was cancelled after rejection'),
    ).toBeTruthy();
  });

  it('groups retry stages, shows sequence position, and prioritizes recovery and failures', () => {
    const { container } = render(
      <ChildTasksPane
        children={[
          {
            operation_id: 'queued-step',
            title: 'Queued step',
            status: 'queued',
            execution_mode: 'sequential',
            operation_group_id: 'review-group',
            group_sequence: 1,
          },
          {
            operation_id: 'retrying',
            title: 'Active retry',
            status: 'running',
            phase: 'tool',
            execution_mode: 'sequential',
            operation_group_id: 'review-group',
            group_sequence: 0,
            operation_attempt: 2,
            lifecycle: [
              { status: 'queued', attempt: 1 },
              { status: 'failed', attempt: 1 },
              { status: 'queued', attempt: 2 },
              { status: 'running', attempt: 2 },
            ],
            reports: [{ attempt: 2, report: '正在修复评审指出的问题' }],
          },
          { operation_id: 'failed', title: 'Failed task', status: 'failed' },
          {
            operation_id: 'not-started',
            title: 'Not started task',
            status: 'not_started',
            operation_error: 'No turn ID returned',
          },
          {
            operation_id: 'recovering',
            title: 'Recovery task',
            status: 'running',
            recovery_required: true,
            recovery_reason: '持久化任务没有匹配的活动 Turn',
          },
        ]}
        loading={false}
        error={null}
        onControl={vi.fn()}
      />,
    );

    expect([...container.querySelectorAll('.child-task-row .child-task-summary strong')]
      .map((node) => node.textContent)).toEqual([
      'Failed task',
      'Not started task',
      'Recovery task',
      'Active retry',
      'Queued step',
    ]);
    expect(container.querySelector('.child-task-count').getAttribute('aria-label'))
      .toBe('运行 1，排队 1，待处理 3，已结束 0，共 5');
    expect(container.querySelector('.child-task-status.not_started')?.textContent).toBe('未开始');
    expect(screen.getByText('No turn ID returned')).toBeTruthy();

    const retry = [...container.querySelectorAll('.child-task-row')]
      .find((row) => row.textContent.includes('Active retry'));
    fireEvent.click(retry.querySelector('.child-task-summary'));
    expect(retry.textContent).toContain('第 2 轮');
    expect(retry.textContent).toContain('第 1/2 步');
    expect(retry.textContent).toContain('执行工具');
    expect(retry.textContent).toContain('正在修复评审指出的问题');
    expect(retry.querySelectorAll('.child-task-attempt')).toHaveLength(2);
    const recovery = [...container.querySelectorAll('.child-task-row')]
      .find((row) => row.textContent.includes('Recovery task'));
    expect(recovery.querySelector('.child-task-stop-quick')).toBeNull();
    fireEvent.click(recovery.querySelector('.child-task-summary'));
    expect(recovery.querySelector('.child-task-recovery')?.textContent)
      .toBe('持久化任务没有匹配的活动 Turn');
    expect(recovery.querySelector('.child-task-actions')).toBeNull();
  });

  it('labels initial, retry, and follow-up rounds from persisted attempt kinds', () => {
    const { container } = render(
      <ChildTasksPane
        children={[{
          operation_id: 'multi-round',
          child_thread_id: 'child-rounds',
          title: 'Review and revise output',
          status: 'running',
          operation_attempt: 3,
          attempt_kind: 'follow_up',
          lifecycle: [
            { status: 'queued', attempt: 1, attempt_kind: 'initial' },
            { status: 'completed', attempt: 1, attempt_kind: 'initial' },
            { status: 'queued', attempt: 2, attempt_kind: 'retry' },
            { status: 'failed', attempt: 2, attempt_kind: 'retry' },
            { status: 'queued', attempt: 3, attempt_kind: 'follow_up' },
            { status: 'running', attempt: 3, attempt_kind: 'follow_up' },
          ],
          reports: [{ attempt: 3, report: '正在处理评审意见' }],
        }]}
        loading={false}
        error={null}
      />,
    );

    const card = container.querySelector('.child-task-row');
    fireEvent.click(card.querySelector('.child-task-summary'));
    expect(card.querySelectorAll('.child-task-attempt')).toHaveLength(3);
    expect(card.textContent).toContain('初始执行');
    expect(card.textContent).toContain('重试 · 第 2 轮');
    expect(card.textContent).toContain('后续委托 · 第 3 轮');
    expect(card.textContent).toContain('后续委托 · 第 3 轮进展：');
  });

  it('pages completed tasks in groups and can collapse the history again', () => {
    const finished = Array.from({ length: 7 }, (_, index) => ({
      operation_id: `done-${index + 1}`,
      title: `Finished ${index + 1}`,
      status: 'completed',
    }));
    render(<ChildTasksPane children={finished} loading={false} error={null} />);

    fireEvent.click(screen.getByRole('button', { name: '显示已结束任务（7）' }));
    expect(screen.getByText('Finished 1')).toBeTruthy();
    expect(screen.getByText('Finished 5')).toBeTruthy();
    expect(screen.queryByText('Finished 6')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '显示更多已结束任务（剩余 2）' }));
    expect(screen.getByText('Finished 7')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '收起已结束任务' }));
    expect(screen.queryByText('Finished 1')).toBeNull();
  });

  it('offers operation controls for running, queued, paused, and failed tasks', async () => {
    const onControl = vi.fn(async (child, action) => ({
      outcome: { outcome: 'applied' },
      child: { ...child, status: action === 'pause' ? 'pausing' : child.status },
    }));
    const { container } = render(
      <ChildTasksPane
        children={[
          {
            operation_id: 'running-op',
            child_thread_id: 'running-child',
            operation_attempt: 1,
            operation_prompt: 'Inspect the runtime',
            title: 'Running task',
            status: 'running',
          },
          {
            operation_id: 'queued-op',
            child_thread_id: 'queued-child',
            operation_attempt: 2,
            operation_prompt: 'Old queued prompt',
            title: 'Queued task',
            status: 'queued',
          },
          {
            operation_id: 'paused-op',
            child_thread_id: 'paused-child',
            operation_attempt: 1,
            title: 'Paused task',
            status: 'paused',
          },
          {
            operation_id: 'failed-op',
            child_thread_id: 'failed-child',
            operation_attempt: 1,
            title: 'Failed task',
            status: 'failed',
          },
        ]}
        loading={false}
        error={null}
        onControl={onControl}
      />,
    );

    const rows = [...container.querySelectorAll('.child-task-row')];
    const running = rows.find((row) => row.textContent.includes('Running task'));
    const queued = rows.find((row) => row.textContent.includes('Queued task'));
    const paused = rows.find((row) => row.textContent.includes('Paused task'));
    const failed = rows.find((row) => row.textContent.includes('Failed task'));

    for (const row of [running, queued, paused, failed]) {
      fireEvent.click(row.querySelector('.child-task-summary'));
      fireEvent.click(row.querySelector('.child-task-actions > summary'));
    }

    fireEvent.click([...running.querySelectorAll('button')]
      .find((button) => button.textContent.includes('排队后续')));
    fireEvent.change(screen.getByLabelText('子任务指令'), {
      target: { value: 'Check the completed output' },
    });
    fireEvent.click(screen.getByRole('button', { name: '加入后续队列' }));
    await waitFor(() => expect(onControl).toHaveBeenCalledWith(
      expect.objectContaining({ child_thread_id: 'running-child' }),
      'queue_follow_up',
      { prompt: 'Check the completed output' },
    ));

    fireEvent.click([...queued.querySelectorAll('button')]
      .find((button) => button.textContent.includes('修改任务')));
    expect(screen.getByLabelText('子任务指令').value).toBe('Old queued prompt');
    fireEvent.change(screen.getByLabelText('子任务指令'), {
      target: { value: 'Updated prompt' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(onControl).toHaveBeenCalledWith(
      expect.objectContaining({ child_thread_id: 'queued-child' }),
      'update_queued',
      { prompt: 'Updated prompt' },
    ));

    fireEvent.click([...paused.querySelectorAll('button')]
      .find((button) => button.textContent.includes('继续')));
    fireEvent.click([...failed.querySelectorAll('button')]
      .find((button) => button.textContent.includes('重试')));
    await waitFor(() => expect(onControl).toHaveBeenCalledWith(
      expect.objectContaining({ child_thread_id: 'paused-child' }),
      'resume',
      undefined,
    ));
    expect(onControl).toHaveBeenCalledWith(
      expect.objectContaining({ child_thread_id: 'failed-child' }),
      'retry',
      undefined,
    );
  });

  it('surfaces a full follow-up queue rejection', async () => {
    const onControl = vi.fn().mockRejectedValue(new Error('a child task can have only one pending follow-up'));
    const { container } = render(
      <ChildTasksPane
        children={[{
          operation_id: 'running-op',
          child_thread_id: 'running-child',
          operation_attempt: 1,
          title: 'Running task',
          status: 'running',
        }]}
        loading={false}
        error={null}
        onControl={onControl}
      />,
    );
    const row = container.querySelector('.child-task-row');
    fireEvent.click(row.querySelector('.child-task-summary'));
    fireEvent.click(row.querySelector('.child-task-actions > summary'));
    fireEvent.click([...row.querySelectorAll('button')]
      .find((button) => button.textContent.includes('排队后续')));
    fireEvent.change(screen.getByLabelText('子任务指令'), {
      target: { value: 'Another instruction' },
    });
    fireEvent.click(screen.getByRole('button', { name: '加入后续队列' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'a child task can have only one pending follow-up',
    );
  });

  it('keeps running controls compact and confirms stop before sending it', async () => {
    const onControl = vi.fn(async (child) => ({
      outcome: { outcome: 'applied' },
      child: { ...child, status: 'cancelling' },
    }));
    const { container } = render(
      <ChildTasksPane
        children={[{
          operation_id: 'running-op',
          child_thread_id: 'running-child',
          title: 'Running task',
          status: 'running',
          phase: 'model',
          duration_ms: 4_000,
        }]}
        loading={false}
        error={null}
        onControl={onControl}
      />,
    );

    expect(screen.getByRole('group', {
      name: '运行 1，排队 0，待处理 0，已结束 0，共 1',
    })).toBeTruthy();
    expect(screen.getByText('模型处理中')).toBeTruthy();
    expect(screen.getByText('4.0s')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '暂停' })).toBeNull();
    expect(screen.queryByRole('button', { name: '发送指令' })).toBeNull();
    expect(screen.queryByRole('button', { name: '排队后续' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '停止Running task' }));
    expect(screen.getByRole('group', { name: '停止Running task确认' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认停止' }));
    await waitFor(() => expect(onControl).toHaveBeenCalledWith(
      expect.objectContaining({ child_thread_id: 'running-child' }),
      'cancel',
      undefined,
    ));
    expect(screen.getByText('服务端已确认')).toBeTruthy();

    const row = container.querySelector('.child-task-row');
    fireEvent.click(row.querySelector('.child-task-summary'));
    fireEvent.click(row.querySelector('.child-task-actions > summary'));
    expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '发送指令' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '排队后续' })).toBeTruthy();
  });

  it('shows frozen Session state and requires explicit continue', async () => {
    const onSessionControl = vi.fn().mockResolvedValue({
      session_control: { status: 'resuming' },
    });
    render(
      <ChildTasksPane
        children={[{
          operation_id: 'queued-op',
          child_thread_id: 'queued-child',
          title: 'Queued task',
          status: 'queued',
        }]}
        loading={false}
        error={null}
        sessionControl={{ status: 'frozen' }}
        onSessionControl={onSessionControl}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('会话已冻结');
    fireEvent.click(screen.getByRole('button', { name: '继续整个会话' }));
    await waitFor(() => expect(onSessionControl).toHaveBeenCalledWith('continue'));
  });

  it('keeps whole-Session freeze available separately while child work is active', async () => {
    const onSessionControl = vi.fn().mockResolvedValue({
      session_control: { status: 'freezing' },
    });
    render(
      <ChildTasksPane
        children={[{
          operation_id: 'running-op',
          child_thread_id: 'running-child',
          title: 'Running task',
          status: 'running',
        }]}
        loading={false}
        error={null}
        sessionControl={{ status: 'running' }}
        onSessionControl={onSessionControl}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '停止整个会话' }));
    await waitFor(() => expect(onSessionControl).toHaveBeenCalledWith('freeze'));
  });

  it('shows freeze settlement as pending instead of enabling another stop', () => {
    render(
      <ChildTasksPane
        children={[]}
        loading={false}
        error={null}
        parentTurnActive
        sessionControl={{ status: 'freezing' }}
      />,
    );

    const pending = screen.getByRole('button', { name: '正在停止…' });
    expect(pending.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: '停止整个会话' })).toBeNull();
  });

  it('allows retrying a persisted Session resume', async () => {
    const onSessionControl = vi.fn().mockResolvedValue({
      session_control: { status: 'resuming' },
    });
    render(
      <ChildTasksPane
        children={[]}
        loading={false}
        error={null}
        sessionControl={{ status: 'resuming' }}
        onSessionControl={onSessionControl}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '重试恢复' }));
    await waitFor(() => expect(onSessionControl).toHaveBeenCalledWith('continue'));
  });

  it('distinguishes a persisted child report from one read by the main Thread', () => {
    render(
      <ChildTasksPane
        children={[{
          operation_id: 'report-op',
          child_thread_id: 'report-child',
          title: 'Reported progress',
          status: 'running',
          reports: [{
            cursor: 9,
            report_id: 'report-9',
            attempt: 1,
            report: 'Scanned the source files',
            delivery_status: 'main_received',
          }],
        }]}
        loading={false}
        error={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /展开任务详情：Reported progress/ }));
    expect(screen.getByText('Scanned the source files')).toBeTruthy();
    expect(screen.getByText('主线程已收到')).toBeTruthy();
  });
});
