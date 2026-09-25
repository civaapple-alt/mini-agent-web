import React, { useEffect, useRef, useState } from 'react';
import {
  Boxes,
  Check,
  Palette,
  RotateCcw,
  Save,
  Settings,
  Shield,
  X,
} from 'lucide-react';
import { api } from '../api';
import { normalizeTheme } from '../utils/statusModel.js';
import ModelSettingsPanel from './ModelSettingsPanel';
import './SettingsModal.css';

const SETTINGS_GROUPS = [
  {
    label: '偏好设置',
    items: [
      {
        id: 'security',
        label: '安全与运行',
        description: '审批缓存与运行边界',
        icon: Shield,
      },
      {
        id: 'appearance',
        label: '界面与外观',
        description: '主题和内容显示',
        icon: Palette,
      },
    ],
  },
  {
    label: 'Agent 能力',
    items: [
      {
        id: 'models',
        label: '模型设置',
        description: '供应商、模型与默认值',
        icon: Boxes,
      },
    ],
  },
];

const DEFAULT_SETTINGS = {
  theme: 'light',
  auto_scroll: true,
  word_wrap: true,
  font_size: 13,
};

export default function SettingsModal({
  isOpen,
  onClose,
  onSettingsSaved,
  onToast,
  projectId = null,
  initialTab = 'preferences',
}) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [approvalInfo, setApprovalInfo] = useState(null);
  const [isRevokingApprovals, setIsRevokingApprovals] = useState(false);
  const [activeSection, setActiveSection] = useState('security');
  const requestEpochRef = useRef(0);
  const requestControllerRef = useRef(null);
  const activeSectionInfo = SETTINGS_GROUPS
    .flatMap((group) => group.items)
    .find((item) => item.id === activeSection) || SETTINGS_GROUPS[0].items[0];

  useEffect(() => {
    requestControllerRef.current?.abort();
    requestEpochRef.current += 1;
    if (!isOpen) return undefined;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const requestEpoch = requestEpochRef.current;
    const context = { epoch: requestEpoch, signal: controller.signal };
    void loadSettings(context);
    void loadApprovalInfo(context);
    return () => {
      controller.abort();
      requestEpochRef.current += 1;
    };
  }, [isOpen, projectId]);

  useEffect(() => {
    if (isOpen) setActiveSection(initialTab === 'models' ? 'models' : 'security');
  }, [initialTab, isOpen]);

  const isCurrentRequest = (context) => (
    context && context.epoch === requestEpochRef.current
  );

  const updateSetting = (name, value) => {
    setSettings((current) => ({ ...current, [name]: value }));
    setSavedSuccess(false);
  };

  const loadSettings = async (context = null) => {
    try {
      const data = await api.getSettings({ projectId, signal: context?.signal });
      if (isCurrentRequest(context)) {
        const preferenceData = { ...data };
        delete preferenceData.reasoning_effort;
        setSettings((previous) => ({
          ...previous,
          ...preferenceData,
          theme: normalizeTheme(data.theme || previous.theme),
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
      const response = await api.updateSettings(settings, {
        projectId,
        signal: context.signal,
      });
      if (!isCurrentRequest(context)) return;
      setSavedSuccess(true);
      if (onSettingsSaved) onSettingsSaved(response.settings);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (err) {
      if (err?.name === 'AbortError' || !isCurrentRequest(context)) return;
      if (onToast) onToast(`保存设置失败: ${err.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setSettings({ ...DEFAULT_SETTINGS });
    setSavedSuccess(false);
  };

  if (!isOpen) return null;

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div
        className="settings-modal-container"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="系统设置"
      >
        <header className="settings-modal-header">
          <div className="modal-title-group">
            <Settings size={17} className="text-emerald" />
            <div>
              <h3>设置</h3>
              <span>偏好设置与模型配置</span>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="关闭设置">
            <X size={17} />
          </button>
        </header>

        <div className="settings-modal-main">
          <nav className="settings-modal-sidebar" aria-label="设置菜单">
            {SETTINGS_GROUPS.map((group) => (
              <div className="settings-nav-group" key={group.label}>
                <h4>{group.label}</h4>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const selected = activeSection === item.id;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={`settings-nav-item${selected ? ' active' : ''}`}
                      aria-current={selected ? 'page' : undefined}
                      onClick={() => setActiveSection(item.id)}
                    >
                      <Icon size={16} aria-hidden="true" />
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <main className="settings-modal-detail">
            <div className="settings-detail-scroll custom-scrollbar">
              {activeSection === 'models' ? (
                <ModelSettingsPanel projectId={projectId} onToast={onToast} />
              ) : (
                <>
                  <div className="settings-detail-heading">
                    <div>
                      <h2>{activeSectionInfo.label}</h2>
                      <p>{activeSectionInfo.description}</p>
                    </div>
                  </div>

                  {activeSection === 'security' && (
                    <section className="settings-preference-section">
                      <div className="settings-section-intro">
                        <Shield size={17} />
                        <div>
                          <h3>安全与运行边界</h3>
                          <p>执行范围和批准策略由运行状态栏与 Host 管理。</p>
                        </div>
                      </div>
                      <div className="settings-preference-card approval-state-card">
                        <div className="setting-text">
                          <strong className="setting-title">当前项目批准缓存</strong>
                          <span className="setting-desc">
                            {approvalInfo?.pending_requests?.length ?? '读取中'} 个待处理请求
                            <span className="settings-meta-separator">·</span>
                            授权存储：{approvalInfo?.grant_store || 'Host/Capabilities'}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn-revoke-approvals"
                          onClick={() => void handleRevokeApprovals()}
                          disabled={isRevokingApprovals}
                        >
                          {isRevokingApprovals ? '撤销中...' : '撤销已批准'}
                        </button>
                      </div>
                    </section>
                  )}

                  {activeSection === 'appearance' && (
                    <section className="settings-preference-section">
                      <div className="settings-section-intro">
                        <Palette size={17} />
                        <div>
                          <h3>界面外观与交互</h3>
                          <p>调整 Web Studio 的主题和会话内容呈现方式。</p>
                        </div>
                      </div>
                      <div className="settings-preference-card settings-preference-list">
                        <div className="setting-item">
                          <div className="setting-text">
                            <strong className="setting-title">色彩主题</strong>
                            <span className="setting-desc">选择适合当前工作环境的配色。</span>
                          </div>
                          <select
                            className="setting-select"
                            value={settings.theme}
                            onChange={(event) => updateSetting('theme', event.target.value)}
                          >
                            <option value="light">浅色</option>
                            <option value="dark">深色</option>
                          </select>
                        </div>
                        <label className="setting-item setting-toggle-row">
                          <span className="setting-text">
                            <strong className="setting-title">自动跟随流式输出</strong>
                            <span className="setting-desc">模型输出时保持视图跟随最新消息。</span>
                          </span>
                          <input
                            type="checkbox"
                            checked={settings.auto_scroll}
                            onChange={(event) => updateSetting('auto_scroll', event.target.checked)}
                          />
                          <span className="settings-toggle-control" aria-hidden="true" />
                        </label>
                        <label className="setting-item setting-toggle-row">
                          <span className="setting-text">
                            <strong className="setting-title">代码与长文本自动换行</strong>
                            <span className="setting-desc">在工具输出和代码卡片中启用换行。</span>
                          </span>
                          <input
                            type="checkbox"
                            checked={settings.word_wrap}
                            onChange={(event) => updateSetting('word_wrap', event.target.checked)}
                          />
                          <span className="settings-toggle-control" aria-hidden="true" />
                        </label>
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>

            {activeSection !== 'models' && (
              <footer className="settings-modal-footer">
                <button type="button" className="btn-reset" onClick={handleReset} title="恢复默认设置">
                  <RotateCcw size={14} />
                  <span>恢复默认</span>
                </button>
                <div className="footer-right">
                  <button type="button" className="btn-cancel" onClick={onClose}>取消</button>
                  <button type="button" className="btn-save" onClick={() => void handleSave()} disabled={isSaving}>
                    {savedSuccess ? <Check size={14} /> : <Save size={14} />}
                    <span>{savedSuccess ? '已保存' : isSaving ? '保存中...' : '保存配置'}</span>
                  </button>
                </div>
              </footer>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
