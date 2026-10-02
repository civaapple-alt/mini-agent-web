import React, { useRef, useState } from 'react';

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
  const requestRef = useRef(null);
  const toolCallId = call.tool_call_id || call.toolCallId || '';
  const name = call.name || '未知工具';
  const evidenceBytes = byteLength(evidence);
  const resultBytes = byteLength(resultContent);
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
      <label>
        核对依据（最多 1024 字节）
        <textarea
          value={evidence}
          maxLength={1024}
          rows={2}
          onChange={(event) => updateEvidence(event.target.value)}
        />
      </label>
      <small>{evidenceBytes} / {EVIDENCE_BYTE_LIMIT} 字节</small>
      <label>
        已确认完成时提交的结果（最多 64 KiB）
        <textarea
          value={resultContent}
          maxLength={RESULT_BYTE_LIMIT}
          rows={3}
          onChange={(event) => updateResult(event.target.value)}
        />
      </label>
      <small>{resultBytes} / {RESULT_BYTE_LIMIT} 字节</small>
      <div className="turn-reconciliation-actions">
        <button
          type="button"
          className="turn-recovery-button"
          disabled={!canSubmit}
          onClick={() => submit('completed')}
        >
          记录已完成结果
        </button>
        <button
          type="button"
          className="turn-recovery-button"
          disabled={!canSubmit}
          onClick={() => submit('not_executed')}
        >
          确认未执行
        </button>
      </div>
    </section>
  );
}
