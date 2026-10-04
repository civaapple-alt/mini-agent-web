import React, { useId, useRef, useState } from 'react';

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
  const [evidence, setEvidence] = useState('');
  const [resultContent, setResultContent] = useState('');
  const inputId = useId();
  const requestRef = useRef(null);
  const toolCallId = call.tool_call_id || call.toolCallId || '';
  const name = call.name || '未知工具';
  const evidenceBytes = byteLength(evidence);
  const resultBytes = byteLength(resultContent);
  const evidenceHelpId = `${inputId}-evidence-help`;
  const resultHelpId = `${inputId}-result-help`;
  const completedHelpId = `${inputId}-completed-help`;
  const notExecutedHelpId = `${inputId}-not-executed-help`;
  const canSubmit = Boolean(
    onSubmit
      && evidence.trim()
      && evidenceBytes <= EVIDENCE_BYTE_LIMIT
      && resultBytes <= RESULT_BYTE_LIMIT
      && !busy,
  );

  const submit = (disposition) => {
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
      <div className="turn-reconciliation-fields">
        <div className="turn-reconciliation-field">
          <label>
            核对依据（最多 1024 字节）
            <textarea
              value={evidence}
              maxLength={1024}
              rows={3}
              aria-describedby={evidenceHelpId}
              placeholder="说明你如何确认工具是否执行，例如检查目标状态或执行日志。"
              onChange={(event) => updateEvidence(event.target.value)}
            />
          </label>
          <small id={evidenceHelpId} className="turn-reconciliation-help">
            必填。写明核对来源和你观察到的实际状态。
          </small>
          <small className="turn-reconciliation-count">
            {evidenceBytes} / {EVIDENCE_BYTE_LIMIT} 字节
          </small>
        </div>
        <div className="turn-reconciliation-field">
          <label>
            已确认完成时提交的结果（最多 64 KiB）
            <textarea
              value={resultContent}
              maxLength={RESULT_BYTE_LIMIT}
              rows={3}
              aria-describedby={resultHelpId}
              placeholder="粘贴工具实际返回给模型的内容。没有文本输出时可留空。"
              onChange={(event) => updateResult(event.target.value)}
            />
          </label>
          <small id={resultHelpId} className="turn-reconciliation-help">
            只有选择“记录已完成结果”时才会提交此内容。
          </small>
          <small className="turn-reconciliation-count">
            {resultBytes} / {RESULT_BYTE_LIMIT} 字节
          </small>
        </div>
      </div>
      <div className="turn-reconciliation-actions">
        <div className="turn-reconciliation-action">
          <button
            type="button"
            className="turn-recovery-button"
            aria-describedby={completedHelpId}
            disabled={!canSubmit}
            onClick={() => submit('completed')}
          >
            记录已完成结果
          </button>
          <small id={completedHelpId}>
            记录后不会重跑这条调用。处理完所有待核对项后，再点“继续当前 Turn”。
          </small>
        </div>
        <div className="turn-reconciliation-action">
          <button
            type="button"
            className="turn-recovery-button"
            aria-describedby={notExecutedHelpId}
            disabled={!canSubmit}
            onClick={() => submit('not_executed')}
          >
            确认未执行
          </button>
          <small id={notExecutedHelpId}>
            处理完所有待核对项后，点“继续当前 Turn”会重新运行这条调用。只在确认没有副作用时选择。
          </small>
        </div>
      </div>
    </section>
  );
}
