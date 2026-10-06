import React, { useId, useRef, useState } from 'react';
import './TurnReconciliationForm.css';

const EVIDENCE_BYTE_LIMIT = 1024;
const RESULT_BYTE_LIMIT = 64 * 1024;

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

function createRequestId() {
  if (globalThis.crypto?.randomUUID) return `web-reconcile-${globalThis.crypto.randomUUID()}`;
  return `web-reconcile-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function TurnReconciliationForm({
  call,
  busy,
  disabled = false,
  blockedMessage = null,
  toolArguments,
  toolArgumentsLoaded = false,
  toolArgumentsLoading = false,
  toolArgumentsError = null,
  onSubmit,
}) {
  const [outcome, setOutcome] = useState('');
  const [evidence, setEvidence] = useState('');
  const [resultContent, setResultContent] = useState('');
  const inputId = useId();
  const requestRef = useRef(null);
  const toolCallId = call.tool_call_id || call.toolCallId || '';
  const name = call.name || '未知工具';
  const evidenceBytes = byteLength(evidence);
  const resultBytes = byteLength(resultContent);
  const evidenceOverLimit = evidenceBytes > EVIDENCE_BYTE_LIMIT;
  const resultOverLimit = resultBytes > RESULT_BYTE_LIMIT;
  const evidenceId = `${inputId}-evidence`;
  const resultId = `${inputId}-result`;
  const canSubmit = Boolean(
    onSubmit
      && outcome
      && evidence.trim()
      && evidenceBytes <= EVIDENCE_BYTE_LIMIT
      && (outcome === 'not_executed' || resultBytes <= RESULT_BYTE_LIMIT)
      && !busy
      && !disabled,
  );
  const argumentText = typeof toolArguments === 'string'
    ? toolArguments
    : JSON.stringify(toolArguments, null, 2) ?? String(toolArguments);
  const argumentTitle = ['shell', 'bash', 'exec', 'run_command'].includes(name.toLowerCase())
    ? 'Shell 命令与参数'
    : '工具调用参数';

  const submit = () => {
    if (!canSubmit) return;
    const content = outcome === 'not_executed' ? '' : resultContent;
    const identity = JSON.stringify([outcome, content, evidence]);
    if (requestRef.current?.identity !== identity) {
      requestRef.current = { identity, id: createRequestId() };
    }
    onSubmit?.(toolCallId, outcome, content, evidence, requestRef.current.id);
  };

  const updateEvidence = (value) => {
    setEvidence(value);
    requestRef.current = null;
  };

  const updateResult = (value) => {
    setResultContent(value);
    requestRef.current = null;
  };

  const updateOutcome = (value) => {
    if (value !== outcome) {
      setResultContent('');
      requestRef.current = null;
    }
    setOutcome(value);
  };

  return (
    <section
      className="turn-reconciliation-card"
      aria-label={`核对工具 ${name}`}
      data-reconciliation-call-id={toolCallId || undefined}
      tabIndex={-1}
    >
      <strong>{name}</strong>
      <small>调用 ID：{toolCallId}</small>
      <p className="turn-reconciliation-intro">
        这条调用的结果尚未确认。请先检查实际状态，再选择处理方式。保存决定只更新检查点，不会执行工具或继续 Turn。
      </p>

      {(toolArgumentsLoading || toolArgumentsError || toolArgumentsLoaded) && (
        <section className="turn-reconciliation-arguments" aria-label={argumentTitle}>
          <div className="turn-reconciliation-arguments-heading">
            <strong>{argumentTitle}</strong>
            <small>敏感字段已脱敏，内容有长度限制</small>
          </div>
          {toolArgumentsLoading && <p role="status">正在读取工具命令与参数…</p>}
          {toolArgumentsError && <p className="turn-reconciliation-arguments-error" role="alert">
            {toolArgumentsError}
          </p>}
          {toolArgumentsLoaded && <pre>{argumentText}</pre>}
        </section>
      )}

      {disabled && blockedMessage && (
        <p className="turn-reconciliation-blocked" role="status">{blockedMessage}</p>
      )}

      <fieldset className="turn-reconciliation-choice-group" disabled={busy || disabled}>
        <legend>这条工具调用的实际状态</legend>
        <div className="turn-reconciliation-choices">
          <label className={`turn-reconciliation-choice${outcome === 'completed' ? ' selected' : ''}`}>
            <input
              type="radio"
              name={`${inputId}-disposition`}
              value="completed"
              checked={outcome === 'completed'}
              onChange={() => updateOutcome('completed')}
            />
            <span className="turn-reconciliation-choice-title">已执行并成功</span>
            <small>记录成功返回的内容；继续时会复用它，不会重跑这条调用。</small>
          </label>
          <label className={`turn-reconciliation-choice${outcome === 'failed' ? ' selected' : ''}`}>
            <input
              type="radio"
              name={`${inputId}-disposition`}
              value="failed"
              checked={outcome === 'failed'}
              onChange={() => updateOutcome('failed')}
            />
            <span className="turn-reconciliation-choice-title">已执行但失败</span>
            <small>记录真实失败输出；继续时 Agent 会收到失败结果。</small>
          </label>
          <label className={`turn-reconciliation-choice${outcome === 'not_executed' ? ' selected' : ''}`}>
            <input
              type="radio"
              name={`${inputId}-disposition`}
              value="not_executed"
              checked={outcome === 'not_executed'}
              onChange={() => updateOutcome('not_executed')}
            />
            <span className="turn-reconciliation-choice-title">确认尚未执行</span>
            <small>只在确认没有产生副作用时选择；继续时会重新执行这条调用。</small>
          </label>
        </div>
      </fieldset>

      {outcome && (
        <>
          <div className={`turn-reconciliation-fields${outcome === 'not_executed' ? '' : ' with-result'}`}>
            <div className="turn-reconciliation-field">
              <label htmlFor={evidenceId}>核对依据（最多 1024 字节）</label>
              <small id={`${evidenceId}-note`} className="turn-reconciliation-field-note">
                必填；仅作核对记录，不会传给 Agent。
              </small>
              <textarea
                id={evidenceId}
                value={evidence}
                maxLength={EVIDENCE_BYTE_LIMIT}
                rows={3}
                disabled={busy || disabled}
                aria-describedby={`${evidenceId}-note ${evidenceId}-help`}
                placeholder="写明查看了什么，以及确认了什么，例如目标系统状态、文件内容或执行日志。"
                onChange={(event) => updateEvidence(event.target.value)}
              />
              <small id={`${evidenceId}-help`} className="turn-reconciliation-help">
                填写可复查的依据。不要把这段说明当作工具输出。
              </small>
              <small
                className={`turn-reconciliation-count${evidenceOverLimit ? ' over-limit' : ''}`}
                aria-live="polite"
              >
                {evidenceOverLimit
                  ? `超出 ${evidenceBytes - EVIDENCE_BYTE_LIMIT} 字节，请删减后提交。`
                  : `${evidenceBytes} / ${EVIDENCE_BYTE_LIMIT} 字节`}
              </small>
            </div>

            {outcome !== 'not_executed' && (
              <div className="turn-reconciliation-field turn-reconciliation-result-field">
                <label htmlFor={resultId}>
                  {outcome === 'failed' ? '工具实际失败输出（最多 64 KiB）' : '工具实际成功结果（最多 64 KiB）'}
                </label>
                <small id={`${resultId}-note`} className="turn-reconciliation-field-note">
                  可留空；提交后会作为这次调用的真实结果交给 Agent。
                </small>
                <textarea
                  id={resultId}
                  value={resultContent}
                  maxLength={RESULT_BYTE_LIMIT}
                  rows={5}
                  disabled={busy || disabled}
                  aria-describedby={`${resultId}-note ${resultId}-help`}
                  placeholder={outcome === 'failed'
                    ? '粘贴这次调用真实产生的错误或失败输出；没有文本输出时留空。'
                    : '粘贴这次调用真实产生的成功输出；没有文本输出时留空。'}
                  onChange={(event) => updateResult(event.target.value)}
                />
                <small id={`${resultId}-help`} className="turn-reconciliation-help">
                  只填写实际输出，不要把核对依据或推测内容放在这里。
                </small>
                <small
                  className={`turn-reconciliation-count${resultOverLimit ? ' over-limit' : ''}`}
                  aria-live="polite"
                >
                  {resultOverLimit
                    ? `超出 ${resultBytes - RESULT_BYTE_LIMIT} 字节，请删减后提交。`
                    : `${resultBytes} / ${RESULT_BYTE_LIMIT} 字节`}
                </small>
              </div>
            )}
          </div>

          {outcome === 'not_executed' && (
            <p className="turn-reconciliation-warning">
              恢复时会重新运行这条工具调用。若无法确认没有副作用，请先检查目标系统，不要选择此项。
            </p>
          )}

          <p className="turn-reconciliation-next-step">
            保存后会显示最新检查点；所有调用核对完成后，再点击“继续当前 Turn”。
          </p>

          <button
            type="button"
            className="turn-recovery-button turn-reconciliation-submit"
            disabled={!canSubmit || disabled}
            onClick={submit}
          >
            {busy
              ? '正在保存核对决定…'
              : outcome === 'completed'
                ? '保存成功结果'
                : outcome === 'failed'
                  ? '保存失败结果'
                  : '保存未执行确认'}
          </button>
        </>
      )}
    </section>
  );
}
