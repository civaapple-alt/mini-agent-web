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

export default function TurnReconciliationForm({ call, busy, onSubmit }) {
  const [disposition, setDisposition] = useState('');
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
      && disposition
      && evidence.trim()
      && evidenceBytes <= EVIDENCE_BYTE_LIMIT
      && (disposition !== 'completed' || resultBytes <= RESULT_BYTE_LIMIT)
      && !busy,
  );

  const submit = () => {
    if (!canSubmit) return;
    const content = disposition === 'completed' ? resultContent : '';
    const identity = JSON.stringify([disposition, content, evidence]);
    if (requestRef.current?.identity !== identity) {
      requestRef.current = { identity, id: createRequestId() };
    }
    onSubmit?.(toolCallId, disposition, content, evidence, requestRef.current.id);
  };

  const updateEvidence = (value) => {
    setEvidence(value);
    requestRef.current = null;
  };

  const updateResult = (value) => {
    setResultContent(value);
    requestRef.current = null;
  };

  return (
    <section className="turn-reconciliation-card" aria-label={`核对工具 ${name}`}>
      <strong>{name}</strong>
      <small>调用 ID：{toolCallId}</small>
      <p className="turn-reconciliation-intro">
        这条调用的结果尚未确认。请先检查实际状态，再选择处理方式。
      </p>

      <fieldset className="turn-reconciliation-choice-group" disabled={busy}>
        <legend>这条工具调用的实际状态</legend>
        <div className="turn-reconciliation-choices">
          <label className={`turn-reconciliation-choice${disposition === 'completed' ? ' selected' : ''}`}>
            <input
              type="radio"
              name={`${inputId}-disposition`}
              value="completed"
              checked={disposition === 'completed'}
              onChange={() => setDisposition('completed')}
            />
            <span className="turn-reconciliation-choice-title">已执行，记录实际结果</span>
            <small>继续时会复用这份结果，不会再次执行这条调用。</small>
          </label>
          <label className={`turn-reconciliation-choice${disposition === 'not_executed' ? ' selected' : ''}`}>
            <input
              type="radio"
              name={`${inputId}-disposition`}
              value="not_executed"
              checked={disposition === 'not_executed'}
              onChange={() => setDisposition('not_executed')}
            />
            <span className="turn-reconciliation-choice-title">确认尚未执行</span>
            <small>只在确认没有产生副作用时选择；继续时会重新执行这条调用。</small>
          </label>
        </div>
      </fieldset>

      {disposition && (
        <>
          <div className="turn-reconciliation-fields">
            <div className="turn-reconciliation-field">
              <label htmlFor={evidenceId}>核对依据（最多 1024 字节）</label>
              <textarea
                id={evidenceId}
                value={evidence}
                maxLength={EVIDENCE_BYTE_LIMIT}
                rows={3}
                disabled={busy}
                aria-describedby={`${evidenceId}-help`}
                placeholder="说明核对来源，以及你观察到的实际状态。"
                onChange={(event) => updateEvidence(event.target.value)}
              />
              <small id={`${evidenceId}-help`} className="turn-reconciliation-help">
                必填。可填写目标系统状态、文件内容或执行日志等可复查依据。
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

            {disposition === 'completed' && (
              <div className="turn-reconciliation-field">
                <label htmlFor={resultId}>工具实际返回的结果（最多 64 KiB）</label>
                <textarea
                  id={resultId}
                  value={resultContent}
                  maxLength={RESULT_BYTE_LIMIT}
                  rows={3}
                  disabled={busy}
                  aria-describedby={`${resultId}-help`}
                  placeholder="粘贴工具实际返回给模型的内容；工具没有文本输出时可留空。"
                  onChange={(event) => updateResult(event.target.value)}
                />
                <small id={`${resultId}-help`} className="turn-reconciliation-help">
                  这段内容会作为原调用结果交给 Agent 继续处理，请填写实际输出，不要填写核对过程。
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

          {disposition === 'not_executed' && (
            <p className="turn-reconciliation-warning">
              恢复时会重新运行这条工具调用。若无法确认没有副作用，请先检查目标系统，不要选择此项。
            </p>
          )}

          <button
            type="button"
            className="turn-recovery-button turn-reconciliation-submit"
            disabled={!canSubmit}
            onClick={submit}
          >
            {busy
              ? '正在保存核对结果…'
              : disposition === 'completed'
                ? '保存实际结果'
                : '确认未执行并允许重新运行'}
          </button>
        </>
      )}
    </section>
  );
}
