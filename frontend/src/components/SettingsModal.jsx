import React, { useState, useEffect } from 'react';
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
import './SettingsModal.css';

export default function SettingsModal({ isOpen, onClose, onSettingsSaved }) {
  const [settings, setSettings] = useState({
    profile: 'interactive',
    approval_policy: 'per_action',
    default_mode: 'chat',
    reasoning_effort: 'medium',
    theme: 'dark',
    auto_scroll: true,
    word_wrap: true,
    font_size: 13,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      const data = await api.getSettings();
      setSettings((prev) => ({ ...prev, ...data }));
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await api.updateSettings(settings);
      setSavedSuccess(true);
      if (onSettingsSaved) onSettingsSaved(res.settings);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (err) {
      alert(`保存设置失败: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setSettings({
      profile: 'interactive',
      approval_policy: 'per_action',
      default_mode: 'chat',
      reasoning_effort: 'medium',
      theme: 'dark',
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
            <Settings size={16} className="text-sky" />
            <h3>系统与偏好设置 (System Settings)</h3>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="settings-modal-body custom-scrollbar">
          {/* Section 1: Security & Governance */}
          <div className="settings-section">
            <div className="section-label">
              <Shield size={14} className="text-amber" />
              <span>安全审批与运行模式 (Security & Policy)</span>
            </div>

            <div className="setting-item">
              <div className="setting-text">
                <span className="setting-title">客户端运行 Profile</span>
                <span className="setting-desc">控制 Agent 的自主任命与能力协商模式</span>
              </div>
              <select
                className="setting-select"
                value={settings.profile}
                onChange={(e) => setSettings({ ...settings, profile: e.target.value })}
              >
                <option value="interactive">交互模式 (Interactive - 推荐)</option>
                <option value="autonomous">自治模式 (Autonomous)</option>
                <option value="strict">严格模式 (Strict)</option>
              </select>
            </div>

            <div className="setting-item">
              <div className="setting-text">
                <span className="setting-title">安全审批策略 (Approval Policy)</span>
                <span className="setting-desc">触发 Shell 执行或文件修改时的拦截规则</span>
              </div>
              <select
                className="setting-select"
                value={settings.approval_policy}
                onChange={(e) => setSettings({ ...settings, approval_policy: e.target.value })}
              >
                <option value="per_action">每次弹窗确认 (Per-Action - 推荐)</option>
                <option value="auto_approve">全自动放行 (Auto-Approve / Dev)</option>
                <option value="strict">严格拒绝敏感调用 (Strict Deny)</option>
              </select>
            </div>
          </div>

          {/* Section 2: Model & Reasoning */}
          <div className="settings-section">
            <div className="section-label">
              <Sliders size={14} className="text-sky" />
              <span>模型与推理偏好 (Reasoning & Workflow)</span>
            </div>

            <div className="setting-item">
              <div className="setting-text">
                <span className="setting-title">思考深度 (Reasoning Effort)</span>
                <span className="setting-desc">调整 OpenAI o1/o3 / Anthropic 思考预算</span>
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

            <div className="setting-item">
              <div className="setting-text">
                <span className="setting-title">默认启动模式 (Default Mode)</span>
                <span className="setting-desc">新建会话时的默认模式</span>
              </div>
              <select
                className="setting-select"
                value={settings.default_mode}
                onChange={(e) => setSettings({ ...settings, default_mode: e.target.value })}
              >
                <option value="chat">常规对话模式 (Chat)</option>
                <option value="plan">只读规划模式 (Plan Mode)</option>
                <option value="goal">目标收敛模式 (Goal Mode)</option>
              </select>
            </div>
          </div>

          {/* Section 3: UI & Appearance */}
          <div className="settings-section">
            <div className="section-label">
              <Palette size={14} className="text-purple" />
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
                <option value="dark">Cursor Obsidian (深邃黑)</option>
                <option value="midnight">Midnight Blue (极夜蓝)</option>
                <option value="cyberpunk">Cyberpunk Neon (霓虹)</option>
              </select>
            </div>

            <div className="setting-item checkbox">
              <div className="setting-text">
                <span className="setting-title">自动滚动流式输出</span>
                <span className="setting-desc">模型输出新 Token 时保持窗口始终在最下方</span>
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
            <RotateCcw size={13} />
            <span>恢复默认</span>
          </button>

          <div className="footer-right">
            <button className="btn-cancel" onClick={onClose}>
              取消
            </button>
            <button className="btn-save" onClick={handleSave} disabled={isSaving}>
              {savedSuccess ? (
                <>
                  <Check size={13} />
                  <span>已保存</span>
                </>
              ) : (
                <>
                  <Save size={13} />
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
