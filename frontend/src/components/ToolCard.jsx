import React, { useId, useState } from 'react';
import { getManualExpansion, setManualExpansion } from '../utils/activityPresentationState';
import {
  Terminal,
  FileText,
  Folder,
  Cpu,
  Wrench,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import './ToolCard.css';
import UserQuestionCard from './UserQuestionCard';
import ApprovalDock from './input/ApprovalDock';
import TurnReconciliationForm from './TurnReconciliationForm';
import {
  pendingApprovalCallId,
  pendingApprovalRequestId,
  toolCallIdOf,
} from '../utils/attentionTargets.js';

const KNOWN_OUTCOME_PRESENTATIONS = {
  completed: { label: '已完成', className: 'badge completed', Icon: CheckCircle },
  failed: { label: '失败', className: 'badge failed', Icon: AlertTriangle },
  needs_approval: { label: '等待授权', className: 'badge-approval-pending', Icon: ShieldAlert },
  deferred: { label: '暂缓执行', className: 'badge running', Icon: AlertTriangle },
  retryable: { label: '可重试', className: 'badge failed', Icon: AlertTriangle },
};

function outcomePresentation(outcome) {
  if (typeof outcome !== 'string' || outcome.length === 0) return null;
  const normalized = outcome.toLowerCase();
  const known = KNOWN_OUTCOME_PRESENTATIONS[normalized];
  if (known) return known;
  const displayValue = outcome.length > 64
    ? `${outcome.slice(0, 61)}...`
    : outcome;
  return {
    label: `未知状态 (${displayValue})`,
    className: 'badge failed',
    Icon: AlertTriangle,
  };
}

function stripOpaqueWebResultFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const visible = { ...value };
  ['handle', 'cursor', 'nextCursor', 'next_cursor'].forEach((field) => delete visible[field]);
  return visible;
}

export default function ToolCard({
  tool,
  pendingApproval = null,
  pendingApprovals = [],
  pendingUserQuestion = null,
  onRespondUserQuestion = null,
  onRespondApproval = null,
  approvalActionsDisabled = false,
  approvalBlockedMessage = null,
  isInterrupting = false,
  reconciliationCalls = [],
  reconcileExecutionBusy = false,
  onReconcileExecution = null,
  presentationId = null,
}) {
  const detailsId = `tool-details-${useId().replace(/:/g, '')}`;
  const expansionId = presentationId ? `tool-details:${presentationId}` : null;
  const [showDetails, setShowDetails] = useState(
    () => getManualExpansion(expansionId) ?? false,
  );
  const [copied, setCopied] = useState(false);

  const { status, error, id, outcome } = tool;
  const toolCallId = toolCallIdOf(tool) || (id === undefined || id === null ? null : String(id));
  const name = tool.name || tool.toolName || tool.tool || tool.tool_name || '';
  const args = tool.arguments ?? tool.args;
  const rawOutput = tool.output ?? tool.result ?? tool.content ?? null;
  const hasArguments = args !== null && args !== undefined;
  let output = rawOutput;
  const isWebResultTool = ['web_search', 'web_fetch'].includes(name.toLowerCase());
  if (isWebResultTool) {
    try {
      const value = typeof rawOutput === 'string' ? JSON.parse(rawOutput) : rawOutput;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const visible = stripOpaqueWebResultFields(value);
        output = typeof rawOutput === 'string' ? JSON.stringify(visible, null, 2) : visible;
      }
    } catch {
      // Keep non-JSON output visible for provider and validation errors.
    }
  }
  const normalizedStatus = status === 'inProgress' ? 'running' : status;
  const isRunning = normalizedStatus === 'running';
  const normalizedOutcome = typeof outcome === 'string' ? outcome.toLowerCase() : null;
  const isPolicyOutcome = normalizedOutcome === 'needs_approval' || normalizedOutcome === 'deferred';
  const isFailed = !!error
    || normalizedOutcome === 'failed'
    || normalizedOutcome === 'retryable'
    || (normalizedStatus === 'failed' && !isPolicyOutcome);
  const settledOutcome = !isRunning ? outcomePresentation(outcome) : null;
  const isReadFile = name.toLowerCase() === 'read_file';
  const hasOutput = error != null || output != null;
  const hasDetails = hasArguments || hasOutput;
  const approvalState = tool.approval?.state || null;
  const approvalCandidates = [pendingApproval, ...pendingApprovals].filter(Boolean);
  const matchingApproval = approvalCandidates.find((approval) => {
    const callId = pendingApprovalCallId(approval);
    if (callId) return callId === toolCallId;
    const requestId = pendingApprovalRequestId(approval);
    return Boolean(requestId && toolCallId && requestId === toolCallId);
  }) || null;
  const reconciliationCall = toolCallId
    ? reconciliationCalls.find((call) => (
      String(call.tool_call_id || call.toolCallId || '') === toolCallId
    )) || null
    : null;

  // Check if this tool is currently awaiting human approval
  const isAwaitingApproval =
    isRunning && (
      approvalState === 'pending' || (
        Boolean(matchingApproval)
      )
    );

  const approvalResult = approvalState && approvalState !== 'pending'
    ? tool.approval
    : null;
  const approvalScopeLabels = {
    once: '本次',
    session: '会话',
    project: '项目',
  };
  const approvalResultText = approvalResult?.state === 'approved'
    ? `用户已允许${approvalScopeLabels[approvalResult.grantScope] || ''}执行${approvalResult.source === 'other_window' ? ' · 其他窗口已处理' : ''}`
    : approvalResult?.state === 'denied'
      ? `用户已拒绝执行${approvalResult.reason ? ` · ${approvalResult.reason}` : ''}`
      : `审批已失效${approvalResult?.source === 'interrupted' ? ' · Turn 已停止' : ''}`;

  const getToolIcon = (toolName) => {
    const n = (toolName || '').toLowerCase();
    if (n === 'shell' || n === 'bash' || n === 'exec' || n === 'run_command') {
      return <Terminal size={12} className="tool-type-icon text-amber" />;
    }
    if (
      n.includes('file') ||
      n.includes('read') ||
      n.includes('write') ||
      n.includes('edit')
    ) {
      return <FileText size={12} className="tool-type-icon text-sky" />;
    }
    if (n.includes('dir') || n.includes('path') || n.includes('list') || n.includes('find')) {
      return <Folder size={12} className="tool-type-icon text-emerald" />;
    }
    if (n.includes('mcp') || n.includes('fetch') || n.includes('web')) {
      return <Cpu size={12} className="tool-type-icon text-purple" />;
    }
    return <Wrench size={12} className="tool-type-icon" />;
  };

  // Format arguments summary
  let argsSummary = '';
  if (typeof args === 'object' && args !== null) {
    if (name.toLowerCase() === 'web_fetch' && args.handle) {
      argsSummary = '继续读取网页正文';
    } else if (args.command) {
      argsSummary = args.command;
    } else if (args.path || args.file_path || args.target_file || args.TargetFile || args.AbsolutePath) {
      argsSummary = args.path || args.file_path || args.target_file || args.TargetFile || args.AbsolutePath;
      if (isReadFile && (args.offset !== undefined || args.limit !== undefined)) {
        const offset = Number.isInteger(args.offset) && args.offset >= 0 ? args.offset : 0;
        const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : null;
        const firstLine = offset + 1;
        const lastLine = limit ? offset + limit : null;
        argsSummary += lastLine
          ? ` · 第 ${firstLine}-${lastLine} 行`
          : ` · 第 ${firstLine} 行起`;
      }
    } else if (args.query || args.pattern || args.url) {
      argsSummary = args.query || args.pattern || args.url;
    } else if (Object.keys(args).length > 0) {
      argsSummary = JSON.stringify(args);
    }
  } else if (typeof args === 'string') {
    argsSummary = args;
  }

  let displayOutput = error || output;
  if (displayOutput === null || displayOutput === undefined) {
    displayOutput = isRunning ? '等待工具执行结果...' : '(无返回内容)';
  } else if (typeof displayOutput === 'object') {
    displayOutput = JSON.stringify(displayOutput, null, 2);
  } else if (typeof displayOutput === 'string' && displayOutput.trim() === '') {
    displayOutput = '(空输出)';
  }

  const displayArguments = showDetails
    ? !hasArguments
      ? '(无参数)'
      : typeof args === 'string'
        ? args
        : JSON.stringify(
          isWebResultTool ? stripOpaqueWebResultFields(args) : args,
          null,
          2,
        ) || String(args)
    : null;

  const handleCopyOutput = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(displayOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleDetails = () => {
    const nextShowDetails = !showDetails;
    setShowDetails(nextShowDetails);
    setManualExpansion(expansionId, nextShowDetails);
  };

  if (name === 'ask_user') {
    return (
      <UserQuestionCard
        tool={tool}
        pendingInteraction={pendingUserQuestion}
        onRespond={onRespondUserQuestion}
        disabled={approvalActionsDisabled || isInterrupting}
      />
    );
  }

  return (
    <div
      className={`tool-card notranslate ${normalizedStatus || 'running'} ${isFailed ? 'has-error' : ''} ${isAwaitingApproval ? 'awaiting-approval' : ''}`}
      translate="no"
      data-block-id={presentationId || undefined}
      data-tool-call-id={toolCallId || undefined}
      tabIndex={-1}
    >
      {/* Top Tool Header */}
      <div className="tool-header">
        <div className="tool-left-info">
          {getToolIcon(name)}
          <span className="tool-tag font-mono">{name || 'tool'}</span>
          {argsSummary && (
            <span className="tool-args-snippet font-mono">{argsSummary}</span>
          )}
        </div>

        <div className="tool-right-actions">
          {hasDetails && (
            <button
              className="toggle-details-btn font-mono"
              onClick={toggleDetails}
              aria-expanded={showDetails}
              aria-controls={showDetails ? detailsId : undefined}
            >
              <Terminal size={11} />
              <span>{showDetails ? '收起详情' : '查看详情'}</span>
              {showDetails ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </button>
          )}

          <div className="tool-right-badge">
            {isAwaitingApproval ? (
              <span className="badge-approval-pending font-mono">
                <ShieldAlert size={11} className="inline mr-1" />
                等待授权
              </span>
            ) : isRunning && !settledOutcome ? (
              <span className="badge running font-mono">
                <Loader2 size={11} className="animate-spin inline mr-1" />
                运行中
              </span>
            ) : settledOutcome ? (
              <span className={`${settledOutcome.className} font-mono`}>
                <settledOutcome.Icon size={11} className="inline mr-1" />
                {settledOutcome.label}
              </span>
            ) : isFailed ? (
              <span className="badge failed font-mono">
                <AlertTriangle size={11} className="inline mr-1" />
                失败
              </span>
            ) : (
              <span className="badge completed font-mono">
                <CheckCircle size={11} className="inline mr-1" />
                已完成
              </span>
            )}
          </div>
        </div>
      </div>

      {approvalResult && (
        <div
          className={`tool-approval-result ${approvalResult.state}`}
          role="status"
          title={approvalResult.reason || undefined}
        >
          {approvalResult.state === 'approved' ? (
            <CheckCircle size={12} />
          ) : approvalResult.state === 'denied' ? (
            <AlertTriangle size={12} />
          ) : (
            <ShieldAlert size={12} />
          )}
          <span>{approvalResultText}</span>
        </div>
      )}

      {isAwaitingApproval && matchingApproval && (
        <ApprovalDock
          pendingApproval={matchingApproval}
          isInterrupting={isInterrupting}
          actionsDisabled={approvalActionsDisabled}
          blockedMessage={approvalBlockedMessage}
          placement="tool"
          onRespondApproval={onRespondApproval}
        />
      )}

      {reconciliationCall && (
        <TurnReconciliationForm
          call={reconciliationCall}
          busy={reconcileExecutionBusy}
          disabled={approvalActionsDisabled}
          blockedMessage={approvalBlockedMessage}
          onSubmit={onReconcileExecution}
        />
      )}

      {/* Keep complete tool details available without adding rows until requested. */}
      {showDetails && (
        <div id={detailsId} className="tool-details-panel">
          <section className="tool-detail-section" aria-label="工具参数">
            <div className="output-bar">
              <span className="output-label font-mono">工具参数</span>
            </div>
            <div className="tool-output-box font-mono custom-scrollbar">
              <pre>{displayArguments}</pre>
            </div>
          </section>

          <section className="tool-detail-section" aria-label="执行输出">
            <div className="output-bar">
              <span className="output-label font-mono">执行输出</span>

              {hasOutput && (
                <button
                  className="btn-copy-output"
                  onClick={handleCopyOutput}
                  title="复制输出结果"
                >
                  {copied ? <Check size={11} className="text-green" /> : <Copy size={11} />}
                  <span>{copied ? '已复制' : '复制'}</span>
                </button>
              )}
            </div>

            <div className="tool-output-box font-mono custom-scrollbar">
              <pre className={isFailed ? 'text-rose-400' : ''}>{displayOutput}</pre>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
