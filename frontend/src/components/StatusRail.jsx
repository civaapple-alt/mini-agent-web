import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Compass,
  Navigation,
  Shield,
  ShieldAlert,
  X,
} from 'lucide-react';
import './StatusRail.css';

const ACCESS_SCOPES = [
  { id: 'project', label: '项目范围', description: '仅当前 Project 的工作区范围' },
  { id: 'full_machine', label: '完全访问', description: '整机路径范围；仍受 Deny 与沙箱限制' },
];

const POLICIES = [
  { id: 'interactive', label: '交互批准', description: '高风险敏感操作需要显式确认' },
  { id: 'automatic', label: '自动低风险', description: '受限检查自动放行，高风险或越界操作仍需确认' },
  { id: 'trusted', label: '信任执行', description: '普通工作区操作、Shell 和通过 URL 校验的公网读取自动执行；破坏性操作、MCP 与工作区外图片读取仍需确认' },
];

const CONTINUATION_MODES = [
  { id: 'manual', label: '手动推进', description: '每轮使用有界步数，达到上限后由用户继续' },
  { id: 'continuous', label: '连续执行', description: '普通 Chat 使用连续循环，仍受取消和上下文边界约束' },
];

function SettingOption({ icon: Icon, title, value, options, disabled, onChange }) {
  return (
    <div className="status-setting-group">
      <div className="status-setting-heading">
        <Icon size={13} aria-hidden="true" />
        <span>{title}</span>
      </div>
      <div className="status-setting-options">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`status-setting-option ${option.id === value ? 'active' : ''}`}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            title={option.description}
          >
            <span>{option.label}</span>
            {option.id === value && <Check size={12} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function StatusRail({
  status,
  onOpenDetails,
  onOpenPlanDetails,
  onChangeExecution,
  onChangeContinuation,
  onEnableAutoCopilot,
  onContinuePlanning,
  onStartImplementation,
  onClosePlan,
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [showFullAccessConfirm, setShowFullAccessConfirm] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const settingsRef = useRef(null);

  useEffect(() => {
    if (!showSettings && !showFullAccessConfirm) return undefined;
    const handleOutsideClick = (event) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target)) {
        setShowSettings(false);
        setShowFullAccessConfirm(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setShowSettings(false);
        setShowFullAccessConfirm(false);
      }
    };
    window.addEventListener('click', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showSettings, showFullAccessConfirm]);

  const busy = Boolean(status?.lifecycle === 'running'
    || status?.lifecycle === 'approval'
    || status?.lifecycle === 'stopping'
    || status?.process?.turnActive);
  const settings = status?.executionSettings || {};
  const canEditSettings = !busy && !status?.sessionReadOnly && !isSavingSettings;
  const connectionLabel = status?.connection === 'online'
    ? '已连接'
    : status?.connection === 'reconnecting'
      ? '正在恢复连接'
      : '连接中断';
  const scopeLabel = `${status?.scope?.projectId || '默认项目'} / ${status?.scope?.threadId || 'default'}`;

  const handleAccessChange = (nextScope) => {
    if (nextScope === 'full_machine' && settings.accessScope !== 'full_machine') {
      setShowFullAccessConfirm(true);
      return;
    }
    handleExecutionChange(nextScope, settings.policy);
  };

  const confirmFullAccess = () => {
    handleExecutionChange('full_machine', settings.policy);
  };

  const handleExecutionChange = async (nextAccess, nextPolicy) => {
    setIsSavingSettings(true);
    try {
      await onChangeExecution?.(nextAccess, nextPolicy);
      setShowFullAccessConfirm(false);
      setShowSettings(false);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleContinuationChange = async (nextMode) => {
    setIsSavingSettings(true);
    try {
      await onChangeContinuation?.(nextMode);
      setShowSettings(false);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleAutoCopilot = async () => {
    setIsSavingSettings(true);
    try {
      await onEnableAutoCopilot?.();
      setShowSettings(false);
    } finally {
      setIsSavingSettings(false);
    }
  };

  if (!status) return null;

  return (
    <section className={`status-rail lifecycle-${status.lifecycle} connection-${status.connection}`} role="status" aria-label="运行状态">
      <div className="status-rail-main">
        <span className="status-rail-dot" aria-hidden="true" />
        <span className="status-rail-label">{status.label}</span>
        <span className="status-rail-summary" title={status.summary}>{status.summary}</span>
        {status.nextAction && <span className="status-rail-next">· {status.nextAction}</span>}
      </div>

      <div className="status-rail-meta">
        <span className="status-scope" title={`Project / Session: ${scopeLabel}`}>
          {scopeLabel}
        </span>
        {status.scope.turnId && (
          <span className="status-turn-id font-mono" title={status.scope.turnId}>
            Turn {status.scope.turnId}
          </span>
        )}
        <span className={`status-connection status-connection-${status.connection}`}>
          {connectionLabel}
        </span>
        <div className="status-rail-actions" ref={settingsRef}>
          <button
            type="button"
            className={`status-rail-button status-settings-button ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings((value) => !value)}
            aria-expanded={showSettings}
          >
            <Shield size={12} aria-hidden="true" />
            <span>{settings.summary || '运行设置'}</span>
            <ChevronDown size={11} aria-hidden="true" />
          </button>
          {showSettings && (
            <div className="status-settings-popover" role="dialog" aria-label="运行设置">
              <div className="status-settings-header">
                <div>
                  <strong>运行设置</strong>
                  <span>{scopeLabel}</span>
                </div>
                <button
                  type="button"
                  className="status-settings-close"
                  onClick={() => setShowSettings(false)}
                  aria-label="关闭运行设置"
                >
                  <X size={13} />
                </button>
              </div>

              {!canEditSettings && (
                <div className="status-settings-locked" role="note">
                  <ShieldAlert size={13} aria-hidden="true" />
                  <span>{status.sessionReadOnly ? '当前会话只读，无法修改运行设置' : '当前 Turn 结束后可修改运行设置'}</span>
                </div>
              )}

              {isSavingSettings && (
                <div className="status-settings-saving" role="status">保存运行设置中...</div>
              )}

              <SettingOption
                icon={Shield}
                title="项目执行范围"
                value={settings.accessScope}
                options={ACCESS_SCOPES}
                disabled={!canEditSettings}
                onChange={handleAccessChange}
              />
              <SettingOption
                icon={ShieldAlert}
                title="审批策略"
                value={settings.policy}
                options={POLICIES}
                disabled={!canEditSettings}
                onChange={(value) => {
                  handleExecutionChange(settings.accessScope, value);
                }}
              />
              <SettingOption
                icon={Navigation}
                title="会话推进方式"
                value={settings.continuationMode}
                options={CONTINUATION_MODES}
                disabled={!canEditSettings || status.workflow?.goalStatus === 'active'}
                onChange={(value) => {
                  handleContinuationChange(value);
                }}
              />

              {status.workflow?.goalStatus === 'active' && (
                <p className="status-settings-note">Goal 已接管当前会话的连续推进。</p>
              )}
              <button
                type="button"
                className="status-autopilot-button"
                disabled={!canEditSettings}
                onClick={() => {
                  handleAutoCopilot();
                }}
              >
                <Compass size={12} aria-hidden="true" />
                <span>启用 Auto Copilot</span>
              </button>
            </div>
          )}

          {showFullAccessConfirm && (
            <div className="status-access-confirm" role="dialog" aria-modal="true" aria-label="确认启用完全访问">
              <div className="status-access-confirm-heading">
                <ShieldAlert size={15} aria-hidden="true" />
                <strong>确认启用完全访问</strong>
              </div>
              <p>Agent 将获得整机路径范围的访问能力；普通工作区操作和 Shell 可自动执行，但 Deny 规则、Plan 锁、破坏性命令和外部工具审批仍然有效。</p>
              <div className="status-access-confirm-actions">
                <button type="button" onClick={() => setShowFullAccessConfirm(false)}>取消</button>
                <button type="button" className="primary" onClick={confirmFullAccess}>
                  <Check size={12} aria-hidden="true" />
                  确认启用
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {status.workflow?.planActive && (
        <div className="status-workflow-actions">
          <Compass size={13} aria-hidden="true" />
          <span>Plan</span>
          {status.workflow.planReviewPending ? (
            <>
              <button type="button" onClick={onOpenPlanDetails || onOpenDetails}>查看计划</button>
              <button type="button" onClick={onContinuePlanning}>继续规划</button>
              <button type="button" className="primary" onClick={onStartImplementation}>开始实施</button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClosePlan}
              disabled={busy}
              title={busy ? '当前 Turn 结束后才能关闭 Plan Mode' : '关闭 Plan Mode'}
            >
              {busy ? '运行结束后可关闭' : '关闭 Plan'}
            </button>
          )}
        </div>
      )}

      {status.workflow?.goalStatus && !status.workflow.planActive && (
        <div className="status-workflow-chip">
          <span>Goal</span>
          <strong>{status.workflow.goalStatus}</strong>
          {status.workflow.goalObjective && (
            <span className="status-goal-objective" title={status.workflow.goalObjective}>
              {status.workflow.goalObjective}
            </span>
          )}
          <button type="button" onClick={onOpenPlanDetails || onOpenDetails}>查看详情</button>
        </div>
      )}
    </section>
  );
}
