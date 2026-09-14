import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Settings,
  Shield,
  Sliders,
  Palette,
  Check,
  Save,
  RotateCcw,
} from 'lucide-react';
import { api } from '../api';
import { normalizeTheme } from '../utils/statusModel.js';
import './SettingsModal.css';

export default function SettingsModal({
  isOpen,
  onClose,
  onSettingsSaved,
  onToast,
  projectId = null,
}) {
  const [settings, setSettings] = useState({
    reasoning_effort: 'high',
    theme: 'light',
    auto_scroll: true,
    word_wrap: true,
    font_size: 13,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [approvalInfo, setApprovalInfo] = useState(null);
  const [isRevokingApprovals, setIsRevokingApprovals] = useState(false);
  const requestEpochRef = useRef(0);
  const requestControllerRef = useRef(null);

  useEffect(() => {
    requestControllerRef.current?.abort();
    requestEpochRef.current += 1;
    if (!isOpen) return undefined;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const requestEpoch = requestEpochRef.current;
    const context = { epoch: requestEpoch, signal: controller.signal };
    loadSettings(context);
    loadApprovalInfo(context);
    return () => {
      controller.abort();
      requestEpochRef.current += 1;
    };
  }, [isOpen, projectId]);

  const isCurrentRequest = (context) => (
    context && context.epoch === requestEpochRef.current
  );

  const loadSettings = async (context = null) => {
    try {
      const data = await api.getSettings({ projectId, signal: context?.signal });
      if (isCurrentRequest(context)) {
        setSettings((prev) => ({
          ...prev,
          ...data,
          theme: normalizeTheme(data.theme || prev.theme),
        }));
      }
    } catch (err) {
      if (err?.name === 'AbortError' || (context && !isCurrentRequest(context))) return;
      console.error('Failed to load settings:', err);
    }
  };

  const loadApprovalInfo = async (context = null) => {
    try {
      const data = await api.getWorldApproval({ projectId, signal: context?.signal });
      if (isCurrentRequest(context)) setApprovalInfo(data);
    } catch (err) {
      if (err?.name === 'AbortError' || (context && !isCurrentRequest(context))) return;
      console.error('Failed to load project approval state:', err);
    }
  };

  const handleRevokeApprovals = async () => {
    if (!window.confirm('撤销当前项目已缓存的批准？这会重启当前 App Server。')) return;
    setIsRevokingApprovals(true);
    const context = {
      epoch: requestEpochRef.current,
      signal: requestControllerRef.current?.signal,
    };
    try {
      await api.revokeWorldApprovals({ projectId, signal: context.signal });
      if (!isCurrentRequest(context)) return;
      await loadApprovalInfo(context);
      if (onToast) onToast('当前项目批准已撤销，App Server 已重启', 'success');
    } catch (err) {
      if (err?.name === 'AbortError' || !isCurrentRequest(context)) return;
      if (onToast) onToast(`撤销项目批准失败: ${err.message}`, 'error');
    } finally {
      setIsRevokingApprovals(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    const context = {
      epoch: requestEpochRef.current,
      signal: requestControllerRef.current?.signal,
    };
    try {
      const res = await api.updateSettings(settings, {
        projectId,
        signal: context.signal,
      });
      if (!isCurrentRequest(context)) return;
      setSavedSuccess(true);
      if (onSettingsSaved) onSettingsSaved(res.settings);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (err) {
      if (err?.name === 'AbortError' || !isCurrentRequest(context)) return;
      if (onToast) {
        onToast(`保存设置失败: ${err.message}`, 'error');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setSettings({
      reasoning_effort: 'high',
      theme: 'light',
      auto_scroll: true,
      word_wrap: true,
      font_size: 13,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="settings-modal-header">
          <div className="modal-title-group">
            <Settings size={15} className="text-emerald" />
            <h3>系统与偏好设置 (Settings)</h3>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="settings-modal-body custom-scrollbar">
          {/* Section 1: Security & Governance */}
          <div className="settings-section">
            <div className="section-label">
              <Shield size={13} className="text-amber" />
              <span>安全与运行边界 (Security & Governance)</span>
            </div>

            <div className="setting-item">
              <div className="setting-text">
                <span className="setting-title">访问范围与批准生命周期</span>
                <span className="setting-desc">访问范围、审批策略和推进方式请在顶部运行状态栏的“运行设置”中调整。</span>
              </div>
              <Shield size={20} className="text-amber" />
            </div>

            <div className="approval-state-card">
              <div>
                <span className="setting-title">当前项目批准缓存</span>
                <span className="setting-desc">
                  {approvalInfo?.pending_requests?.length || 0} 个待处理请求 · 授权存储：{approvalInfo?.grant_store || 'Host/Capabilities'}
                </span>
              </div>
              <button
                className="btn-revoke-approvals"
                onClick={handleRevokeApprovals}
                disabled={isRevokingApprovals}
              >
                {isRevokingApprovals ? '撤销中...' : '撤销已批准'}
              </button>
            </div>
          </div>

          {/* Section 2: Model & Reasoning */}
          <div className="settings-section">
            <div className="section-label">
              <Sliders size={13} className="text-sky" />
              <span>模型与推理偏好 (Reasoning & Workflow)</span>
            </div>

            <div className="setting-item">
              <div className="setting-text">
                <span className="setting-title">思考深度 (Reasoning Effort)</span>
                <span className="setting-desc">调整 o1/o3/Claude 思维预算</span>
              </div>
              <select
                className="setting-select"
                value={settings.reasoning_effort}
                onChange={(e) => setSettings({ ...settings, reasoning_effort: e.target.value })}
              >
                <option value="low">低 (Low - 极速响应)</option>
                <option value="medium">中 (Medium - 标准深度)</option>
                <option value="high">高 (High - 复杂逻辑规划)</option>
              </select>
            </div>

          </div>

          {/* Section 3: UI & Appearance */}
          <div className="settings-section">
            <div className="section-label">
              <Palette size={13} className="text-purple" />
              <span>界面外观与交互 (UI & Appearance)</span>
            </div>

            <div className="setting-item">
              <div className="setting-text">
                <span className="setting-title">色彩主题 (Theme)</span>
                <span className="setting-desc">选择符合你习惯的 IDE 主题风格</span>
              </div>
              <select
                className="setting-select"
                value={settings.theme}
                onChange={(e) => setSettings({ ...settings, theme: e.target.value })}
              >
                <option value="light">Light（浅色）</option>
                <option value="dark">Dark（深色）</option>
              </select>
            </div>

            <div className="setting-item checkbox">
              <div className="setting-text">
                <span className="setting-title">自动滚动流式输出</span>
                <span className="setting-desc">模型输出新 Token 时保持窗口在最下方</span>
              </div>
              <input
                type="checkbox"
                checked={settings.auto_scroll}
                onChange={(e) => setSettings({ ...settings, auto_scroll: e.target.checked })}
              />
            </div>

            <div className="setting-item checkbox">
              <div className="setting-text">
                <span className="setting-title">代码与长文本自动换行</span>
                <span className="setting-desc">在工具输出和代码卡片中开启自动换行</span>
              </div>
              <input
                type="checkbox"
                checked={settings.word_wrap}
                onChange={(e) => setSettings({ ...settings, word_wrap: e.target.checked })}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="settings-modal-footer">
          <button className="btn-reset" onClick={handleReset} title="恢复默认设置">
            <RotateCcw size={12} />
            <span>恢复默认</span>
          </button>

          <div className="footer-right">
            <button className="btn-cancel" onClick={onClose}>
              取消
            </button>
            <button className="btn-save" onClick={handleSave} disabled={isSaving}>
              {savedSuccess ? (
                <>
                  <Check size={12} />
                  <span>已保存</span>
                </>
              ) : (
                <>
                  <Save size={12} />
                  <span>{isSaving ? '保存中...' : '保存配置'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
