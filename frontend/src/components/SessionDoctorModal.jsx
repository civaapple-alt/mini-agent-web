import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { api } from '../api';
import './SessionDoctorModal.css';

const inspectionLabels = {
  inspected: '已检查',
  locked_unverified: '有锁，暂未检查',
  unreadable: '无法读取',
};

const integrityLabels = {
  complete: '历史完整',
  history_incomplete: '历史存在缺口',
  invalid: '日志无效',
  unknown: '完整性未知',
};

const recoveryLabels = {
  resumable: '可恢复',
  unavailable: '不可恢复',
  unknown: '恢复状态未知',
};

function count(value) {
  return Number.isSafeInteger(value) ? value : 0;
}

function SessionFinding({ finding, busy, confirming, onConfirm, onRepair, onCancel }) {
  return (
    <li className={`session-doctor-finding ${finding.repair_available ? 'repairable' : ''}`}>
      <div className="session-doctor-finding-heading">
        <code>{finding.session_id}</code>
        <span className={`session-doctor-badge ${finding.issue_code}`}>
          {finding.recommendation}
        </span>
      </div>
      <div className="session-doctor-state-grid">
        <span>检查：{inspectionLabels[finding.inspection] || finding.inspection}</span>
        <span>历史：{integrityLabels[finding.integrity] || finding.integrity}</span>
        <span>恢复：{recoveryLabels[finding.recovery] || finding.recovery}</span>
        {finding.line && <span>位置：第 {finding.line} 行</span>}
        {finding.expected_seq != null && (
          <span>序号：应为 {finding.expected_seq}，实际为 {finding.found_seq}</span>
        )}
        {finding.missing_seq != null && <span>缺失序号：{finding.missing_seq}</span>}
      </div>
      {finding.repair_available && (
        confirming ? (
          <div className="session-doctor-confirm" role="group" aria-label={`确认修复 ${finding.session_id}`}>
            <p>系统会先保存原始日志，再截去未完成的末尾记录。历史缺口不会被补造。</p>
            <button type="button" className="session-doctor-repair" disabled={busy} onClick={onRepair}>
              {busy ? <LoaderCircle size={14} className="session-doctor-spinner" /> : null}
              备份并修复
            </button>
            <button type="button" className="session-doctor-cancel" disabled={busy} onClick={onCancel}>
              取消
            </button>
          </div>
        ) : (
          <button type="button" className="session-doctor-repair" onClick={onConfirm}>
            备份并修复
          </button>
        )
      )}
    </li>
  );
}

export default function SessionDoctorModal({ project, onClose }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [repairingSession, setRepairingSession] = useState(null);
  const [confirmingSession, setConfirmingSession] = useState(null);
  const [error, setError] = useState('');
  const [repairNotice, setRepairNotice] = useState('');

  const scan = useCallback(async (signal) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.inspectProjectSessions(project.id || project.name, { signal });
      setReport(result);
    } catch (scanError) {
      if (scanError?.name !== 'AbortError') setError(scanError.message || '检查 Session 失败');
    } finally {
      setLoading(false);
    }
  }, [project.id, project.name]);

  useEffect(() => {
    const controller = new AbortController();
    void scan(controller.signal);
    return () => controller.abort();
  }, [scan]);

  const repair = async (sessionId) => {
    setRepairingSession(sessionId);
    setError('');
    setRepairNotice('');
    try {
      const result = await api.repairProjectSession(project.id || project.name, sessionId);
      setRepairNotice(`已完成修复，原始日志备份在 ${result.backup_path}`);
      setConfirmingSession(null);
      await scan();
    } catch (repairError) {
      setError(repairError.message || '修复失败，原始日志保持可检查');
    } finally {
      setRepairingSession(null);
    }
  };

  const counts = report?.counts || {};
  const integrityCounts = counts.integrity || {};
  const inspectionCounts = counts.inspection || {};

  return (
    <div className="session-doctor-overlay" onClick={onClose}>
      <section
        className="session-doctor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-doctor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="session-doctor-header">
          <div>
            <h2 id="session-doctor-title">检查 Session 数据</h2>
            <p>{project.name || project.id}</p>
          </div>
          <div className="session-doctor-header-actions">
            <button type="button" aria-label="重新检查" title="重新检查" onClick={() => void scan()} disabled={loading || Boolean(repairingSession)}>
              <RefreshCw size={15} />
            </button>
            <button type="button" aria-label="关闭" title="关闭" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>

        {error && (
          <div className="session-doctor-error" role="alert">
            <AlertTriangle size={15} />
            <span>{error}</span>
            <button type="button" onClick={() => void scan()}>重试</button>
          </div>
        )}
        {repairNotice && (
          <div className="session-doctor-success" role="status">
            <CheckCircle2 size={15} />
            <span>{repairNotice}</span>
          </div>
        )}

        {loading && !report ? (
          <div className="session-doctor-loading" role="status">
            <LoaderCircle size={18} className="session-doctor-spinner" />
            正在检查项目 Session 日志…
          </div>
        ) : report ? (
          <>
            <div className="session-doctor-summary">
              <strong>已检查 {count(report.scanned_sessions)} 个 Session</strong>
              <span>{count(integrityCounts.history_incomplete)} 个历史不完整</span>
              <span>{count(inspectionCounts.locked_unverified)} 个因锁未检查</span>
              <span>{count(inspectionCounts.unreadable)} 个无法读取</span>
              <span>{count(counts.repairable_tails)} 个尾部可修复</span>
            </div>
            {report.sessions_truncated && (
              <p className="session-doctor-notice">超过单次检查的 4096 个 Session 上限，本次结果不完整。请减少项目的历史 Session 后重新检查。</p>
            )}
            {report.findings_truncated && (
              <p className="session-doctor-notice">问题列表已截断，汇总计数仍包含本次检查的全部 Session。</p>
            )}
            <ul className="session-doctor-findings">
              {report.findings.map((finding) => (
                <SessionFinding
                  key={finding.session_id}
                  finding={finding}
                  busy={repairingSession === finding.session_id}
                  confirming={confirmingSession === finding.session_id}
                  onConfirm={() => setConfirmingSession(finding.session_id)}
                  onCancel={() => setConfirmingSession(null)}
                  onRepair={() => void repair(finding.session_id)}
                />
              ))}
              {!report.findings.length && (
                <li className="session-doctor-empty">项目中还没有已保存的 Session。</li>
              )}
            </ul>
          </>
        ) : null}
      </section>
    </div>
  );
}
