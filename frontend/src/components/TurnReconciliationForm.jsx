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
        这条调用的结果尚未确认。请先检查实际状态，再选择处理方式。保存决定只更新检查点，不会执行工具或继续 Turn。
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
              <small id={`${evidenceId}-note`} className="turn-reconciliation-field-note">
                必填；仅作核对记录，不会传给 Agent。
              </small>
              <textarea
                id={evidenceId}
                value={evidence}
                maxLength={EVIDENCE_BYTE_LIMIT}
                rows={3}
                disabled={busy}
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

            {disposition === 'completed' && (
              <div className="turn-reconciliation-field turn-reconciliation-result-field">
                <label htmlFor={resultId}>工具实际返回的结果（最多 64 KiB）</label>
                <small id={`${resultId}-note`} className="turn-reconciliation-field-note">
                  可留空；填写后会作为原调用结果交给 Agent。
                </small>
                <textarea
                  id={resultId}
                  value={resultContent}
                  maxLength={RESULT_BYTE_LIMIT}
                  rows={5}
                  disabled={busy}
                  aria-describedby={`${resultId}-note ${resultId}-help`}
                  placeholder="粘贴这次工具调用真实产生的输出；没有文本输出时留空。"
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

          {disposition === 'not_executed' && (
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
            disabled={!canSubmit}
            onClick={submit}
          >
            {busy
              ? '正在保存核对决定…'
              : disposition === 'completed'
                ? '保存实际结果'
                : '保存未执行确认'}
          </button>
        </>
      )}
    </section>
  );
}
