import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Search, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import './WebSearchSettingsPanel.css';

const PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek 原生搜索', key: 'deepseekApiKey', configured: 'deepseekApiKeyConfigured' },
  { id: 'exa', label: 'Exa Search API', key: 'exaApiKey', configured: 'exaApiKeyConfigured' },
  { id: 'kimi', label: 'Kimi 联网搜索 Basic', key: 'kimiApiKey', configured: 'kimiApiKeyConfigured' },
];

const EMPTY_SETTINGS = {
  provider: 'none',
  deepseekApiKeyConfigured: false,
  exaApiKeyConfigured: false,
  kimiApiKeyConfigured: false,
};

export default function WebSearchSettingsPanel({ onToast, onDraftChange, projectId = null }) {
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [provider, setProvider] = useState('none');
  const [keys, setKeys] = useState({});
  const [removeKeys, setRemoveKeys] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const dirty = useMemo(() => provider !== settings.provider
    || Object.values(keys).some(Boolean)
    || Object.values(removeKeys).some(Boolean), [keys, provider, removeKeys, settings.provider]);

  useEffect(() => onDraftChange?.(dirty), [dirty, onDraftChange]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api.getWebSearchSettings({ projectId, signal: controller.signal })
      .then(({ settings: current }) => {
        setSettings(current);
        setProvider(current.provider);
        setError('');
      })
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') setError(loadError.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [projectId]);

  const save = async () => {
    setSaving(true);
    setError('');
    const payload = { provider };
    for (const item of PROVIDERS) {
      if (removeKeys[item.id]) payload[item.key] = '';
      else if (keys[item.id]?.trim()) payload[item.key] = keys[item.id].trim();
    }
    try {
      const result = await api.updateWebSearchSettings(payload, { projectId });
      setSettings(result.settings);
      setProvider(result.settings.provider);
      setKeys({});
      setRemoveKeys({});
      onToast?.('联网搜索设置已保存', 'success');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="web-search-settings-panel">
      <div className="settings-detail-heading">
        <div>
          <h2>联网搜索</h2>
          <p>选择之后启动的新会话或线程使用的搜索服务，或关闭搜索。</p>
        </div>
      </div>

      {loading ? (
        <div className="web-search-loading"><Loader2 size={16} className="spin" />读取搜索设置…</div>
      ) : (
        <>
          <div className="web-search-provider-card">
            <label htmlFor="web-search-provider">搜索服务</label>
            <select id="web-search-provider" value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value="none">不启用</option>
              {PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <p>启用后，Agent 会使用统一的 <code>web_search</code> 工具。需要阅读正文时会调用 <code>web_fetch</code>；搜索调用可能产生供应商费用。</p>
          </div>

          <div className="web-search-credentials">
            {PROVIDERS.map((item) => {
              const configured = Boolean(settings[item.configured]);
              const removed = Boolean(removeKeys[item.id]);
              return (
                <div className="web-search-key-row" key={item.id}>
                  <div className="web-search-key-heading">
                    <strong>{item.label}</strong>
                    <span className={configured && !removed ? 'configured' : ''}>
                      {removed ? '保存后清除' : configured ? '密钥已配置' : '未配置'}
                    </span>
                  </div>
                  <div className="web-search-key-input-row">
                    <input
                      aria-label={`${item.label} 密钥`}
                      type="password"
                      autoComplete="new-password"
                      value={keys[item.id] || ''}
                      placeholder={configured ? '留空以保留已保存的密钥' : '输入 API Key'}
                      onChange={(event) => {
                        setKeys((current) => ({ ...current, [item.id]: event.target.value }));
                        setRemoveKeys((current) => ({ ...current, [item.id]: false }));
                      }}
                    />
                    {configured && (
                      <button
                        type="button"
                        className="web-search-clear-key"
                        onClick={() => {
                          setKeys((current) => ({ ...current, [item.id]: '' }));
                          setRemoveKeys((current) => ({ ...current, [item.id]: !current[item.id] }));
                        }}
                      >
                        {removed ? '撤销清除' : '清除密钥'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {provider !== 'none' && !settings[PROVIDERS.find((item) => item.id === provider)?.configured] && !keys[provider]?.trim() && (
            <p className="web-search-inline-note">当前服务尚未配置密钥。保存服务选择后，搜索工具不会启用。</p>
          )}
          <div className="web-search-security-note">
            <ShieldCheck size={15} />
            <span>密钥只保存在本机 Host 中。界面只显示是否已配置，不会回读已保存的密钥。</span>
          </div>
          {error && <div className="web-search-error" role="alert">{error}</div>}
          <div className="web-search-save-row">
            <button type="button" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
              {saving ? '保存中…' : '保存搜索设置'}
            </button>
            <span><Search size={13} />搜索仅在选择并配置服务后开放</span>
          </div>
        </>
      )}
    </section>
  );
}
