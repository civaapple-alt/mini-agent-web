import React from 'react';
import { ArrowRight, Compass } from 'lucide-react';

export default function PlanModeBanner({
  reviewPending = false,
  busy = false,
  onOpenDetails,
  onContinuePlanning,
  onStartImplementation,
  onClosePlan,
}) {
  return (
    <div
      className={`plan-topbar ${reviewPending ? 'review' : ''}`}
      role="status"
      aria-label="Plan Mode 状态"
    >
      <div className="plan-topbar-main">
        <Compass size={15} className="plan-topbar-icon" aria-hidden="true" />
        <span className="plan-topbar-label">PLAN MODE</span>
        <span className={`plan-topbar-status ${reviewPending ? 'review' : ''}`}>
          {reviewPending ? '规划已完成，等待确认' : '已开启'}
        </span>
        <span className="plan-topbar-description">
          {reviewPending ? '是否进入实施阶段？' : '源码只读 · Shell 按当前审批策略执行'}
        </span>
      </div>
      <div className="plan-topbar-actions">
        <button type="button" onClick={onOpenDetails}>详情</button>
        {reviewPending ? (
          <>
            <button type="button" onClick={onContinuePlanning}>继续规划</button>
            <button
              type="button"
              className="plan-primary"
              onClick={onStartImplementation}
            >
              <ArrowRight size={12} aria-hidden="true" />
              <span>开始实施</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            className="plan-close"
            onClick={onClosePlan}
            disabled={busy}
            title={busy ? '当前 Turn 结束后才能关闭 Plan Mode' : '关闭 Plan Mode'}
          >
            {busy ? '本轮结束后关闭' : '关闭 Plan Mode'}
          </button>
        )}
      </div>
    </div>
  );
}
