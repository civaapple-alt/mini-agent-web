import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PlanModeBanner from '../components/PlanModeBanner';

describe('PlanModeBanner', () => {
  it('shows the active Plan state and explicit close action', () => {
    const onClosePlan = vi.fn();
    render(<PlanModeBanner onClosePlan={onClosePlan} />);

    expect(screen.getByRole('status', { name: 'Plan Mode 状态' })).toBeDefined();
    expect(screen.getByText('已开启')).toBeDefined();
    expect(screen.getByText('源码只读 · Shell 按当前审批策略执行')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '关闭 Plan Mode' }));
    expect(onClosePlan).toHaveBeenCalledOnce();
  });

  it('asks whether to continue planning or start implementation after a plan turn', () => {
    const onContinuePlanning = vi.fn();
    const onStartImplementation = vi.fn();
    render(
      <PlanModeBanner
        reviewPending
        onContinuePlanning={onContinuePlanning}
        onStartImplementation={onStartImplementation}
      />,
    );

    expect(screen.getByText('规划已完成，等待确认')).toBeDefined();
    expect(screen.getByText('是否进入实施阶段？')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '继续规划' }));
    fireEvent.click(screen.getByRole('button', { name: '开始实施' }));
    expect(onContinuePlanning).toHaveBeenCalledOnce();
    expect(onStartImplementation).toHaveBeenCalledOnce();
  });
});
