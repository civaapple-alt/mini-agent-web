import React, { useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, Loader2, Search, ShieldCheck } from 'lucide-react';
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
  const [searchQuery, setSearchQuery] = useState('Mini Agent Web Studio');
  const [testStates, setTestStates] = useState({});
  const [testingProvider, setTestingProvider] = useState(null);

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

  const clearTestResult = (providerId) => {
    setTestStates((current) => {
      if (!current[providerId]) return current;
      const next = { ...current };
      delete next[providerId];
      return next;
    });
  };

  const testSearch = async (providerId) => {
    const query = searchQuery.trim();
    if (!query) return;
    setTestingProvider(providerId);
    setTestStates((current) => ({ ...current, [providerId]: { loading: true } }));
    try {
      const result = await api.testWebSearch(query, { projectId, provider: providerId });
      setTestStates((current) => ({ ...current, [providerId]: { result } }));
    } catch (testError) {
      setTestStates((current) => ({ ...current, [providerId]: { error: testError.message } }));
    } finally {
      setTestingProvider(null);
    }
  };

  return (
    <section className="web-search-settings-panel">
      <div className="settings-detail-heading">
        <div>
          <h2>联网搜索</h2>
          <p>设置新会话默认使用的搜索服务。</p>
        </div>
      </div>

      {loading ? (
        <div className="web-search-loading"><Loader2 size={16} className="spin" />读取搜索设置…</div>
      ) : (
        <>
          <div className="web-search-provider-card">
            <label htmlFor="web-search-provider">默认搜索服务</label>
            <select id="web-search-provider" value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value="none">不启用</option>
              {PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <p>搜索结果可用 <code>web_fetch</code> 读取页面；测试和搜索调用可能产生服务费用。</p>
          </div>

          <div className="web-search-test-query">
            <label htmlFor="web-search-test-query">测试关键词</label>
            <input
              id="web-search-test-query"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setTestStates({});
              }}
              placeholder="输入测试关键词"
              maxLength={2000}
              disabled={testingProvider !== null}
            />
            <p>输入一次关键词，再从下方对应服务卡片直接测试。</p>
          </div>

          <div className="web-search-credentials">
            {PROVIDERS.map((item) => {
              const configured = Boolean(settings[item.configured]);
              const removed = Boolean(removeKeys[item.id]);
              const hasDraftKey = Boolean(keys[item.id]?.trim());
              const pendingKeyChange = removed || hasDraftKey;
              const canTest = configured && !pendingKeyChange;
              const testState = testStates[item.id];
              const isTesting = testingProvider === item.id;
              const status = removed
                ? '保存后清除'
                : hasDraftKey
                  ? '新密钥待保存'
                  : configured
                    ? '密钥已配置'
                    : '未配置';

              return (
                <div className="web-search-key-row" key={item.id}>
                  <div className="web-search-key-heading">
                    <strong>{item.label}</strong>
                    <div className="web-search-key-actions">
                      <span className={configured && !removed ? 'configured' : ''}>{status}</span>
                      <button
                        type="button"
                        className="web-search-key-test-button"
                        aria-label={`测试 ${item.label}`}
                        title={canTest ? `使用已保存的 ${item.label} 密钥测试` : pendingKeyChange ? '保存密钥后可测试' : '请先配置并保存 API Key'}
                        onClick={() => void testSearch(item.id)}
                        disabled={!canTest || saving || testingProvider !== null || !searchQuery.trim()}
                      >
                        {isTesting ? <Loader2 size={13} className="spin" /> : <Search size={13} />}
                        {isTesting ? '测试中…' : pendingKeyChange ? '保存后测试' : '测试'}
                      </button>
                    </div>
                  </div>
                  <div className="web-search-key-input-row">
                    <input
                      aria-label={`${item.label} 密钥`}
                      type="password"
                      autoComplete="new-password"
                      value={keys[item.id] || ''}
                      placeholder={configured ? '已配置；输入新值可替换' : '输入 API Key'}
                      disabled={testingProvider !== null}
                      onChange={(event) => {
                        setKeys((current) => ({ ...current, [item.id]: event.target.value }));
                        setRemoveKeys((current) => ({ ...current, [item.id]: false }));
                        clearTestResult(item.id);
                      }}
                    />
                    {configured && (
                      <button
                        type="button"
                        className="web-search-clear-key"
                        disabled={testingProvider !== null}
                        onClick={() => {
                          setKeys((current) => ({ ...current, [item.id]: '' }));
                          setRemoveKeys((current) => ({ ...current, [item.id]: !current[item.id] }));
                          clearTestResult(item.id);
                        }}
                      >
                        {removed ? '撤销清除' : '清除 API Key'}
                      </button>
                    )}
                  </div>
                  {testState?.error && (
                    <div className="web-search-test-error" role="alert">测试失败：{testState.error}</div>
                  )}
                  {testState?.result && (
                    <div className="web-search-test-result" role="status">
                      <strong>搜索成功，返回 {testState.result.resultCount} 条结果</strong>
                      {testState.result.results.length === 0 ? (
                        <p>服务已响应，但没有返回结果。</p>
                      ) : (
                        <ul>
                          {testState.result.results.map((result) => (
                            <li key={result.url}>
                              <a href={result.url} target="_blank" rel="noopener noreferrer">
                                {result.title || result.url}<ExternalLink size={12} />
                              </a>
                              {result.snippet && <p>{result.snippet}</p>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="web-search-security-note">
            <ShieldCheck size={15} />
            <span>联网搜索密钥与模型密钥分别由本机 Host 保管；界面只显示配置状态，不会回读已保存的密钥。</span>
          </div>
          {error && <div className="web-search-error" role="alert">{error}</div>}
          <div className="web-search-save-row">
            <button type="button" onClick={() => void save()} disabled={saving || !dirty || testingProvider !== null}>
              {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
              {saving ? '保存中…' : '保存搜索设置'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
