import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KeyRound, Plus, RefreshCw, Save, Sparkles, Trash2, X } from 'lucide-react';
import { api } from '../api';
import './ModelSettingsPanel.css';

const PROVIDER_KINDS = [
  ['deepseek', 'DeepSeek', 'deepseek', 'https://api.deepseek.com'],
  ['kimi', 'Kimi', 'kimi', 'https://api.moonshot.cn/v1'],
  ['glm', 'GLM / Z.ai', 'glm', 'https://open.bigmodel.cn/api/paas/v4'],
  ['volcengine', '字节火山 / Volcengine', 'volcengine', 'https://ark.cn-beijing.volces.com/api/v3'],
  ['custom', '自定义 Responses', 'custom', ''],
];
const MODALITIES = ['text', 'image', 'video', 'pdf'];
const CAPABILITIES = ['structured_output', 'web_search', 'system_messages'];
const REASONING_LEVELS = ['disabled', 'low', 'medium', 'high', 'xhigh', 'max'];
const STANDARD_REASONING_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const API_DEFAULT_REASONING = { kind: 'api_default' };

function reasoningSelectionKey(selection) {
  if (selection?.kind === 'level' && typeof selection.value === 'string') {
    return `level:${selection.value}`;
  }
  return 'api_default';
}

function reasoningSelectionFromKey(key) {
  if (key === 'api_default') return API_DEFAULT_REASONING;
  if (key.startsWith('level:')) return { kind: 'level', value: key.slice('level:'.length) };
  return API_DEFAULT_REASONING;
}

function reasoningLevelLabel(level) {
  return level === 'disabled' ? 'disabled（关闭）' : level;
}

function hasParameterMapping(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length > 0;
}
const SMART_MATCHES = [
  {
    provider: 'deepseek', id: 'deepseek-flash', name: 'DeepSeek Flash',
    inputModalities: ['text', 'image'], reasoningLevels: ['low', 'high', 'max'],
  },
  {
    provider: 'kimi', id: 'kimi-k3', name: 'Kimi K3', contextWindow: 1_048_576,
    inputModalities: ['text', 'image'], reasoningLevels: ['low', 'high', 'max'],
    reasoningParameterMap: {
      low: { reasoning_effort: 'low' },
      high: { reasoning_effort: 'high' },
      max: { reasoning_effort: 'max' },
    },
  },
  {
    provider: 'glm', id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1_000_000,
    maxOutputTokens: 128_000, inputModalities: ['text'], reasoningLevels: ['low', 'high', 'max'],
    reasoningParameterMap: {
      low: { thinking: { type: 'enabled' }, reasoning_effort: 'low' },
      high: { thinking: { type: 'enabled' }, reasoning_effort: 'high' },
      max: { thinking: { type: 'enabled' }, reasoning_effort: 'max' },
    },
  },
  {
    provider: 'volcengine', id: 'doubao-seed-2-1-pro-260628', name: 'Doubao Seed 2.1 Pro',
    inputModalities: ['text'], reasoningLevels: ['low', 'medium', 'high'],
    reasoningParameterMap: {
      low: { thinking: true, reasoning_effort: 'low' },
      medium: { thinking: true, reasoning_effort: 'medium' },
      high: { thinking: true, reasoning_effort: 'high' },
    },
  },
];

const emptyModel = () => ({
  id: '', name: '', enabled: true, contextWindow: '', maxOutputTokens: '',
  inputModalities: ['text'], capabilities: [], reasoningLevels: [],
  reasoningParameterMap: {}, smartManaged: false,
});

function refKey(ref) {
  return ref ? `${ref.providerId}::${ref.modelId}` : '';
}

function fromRef(value) {
  if (!value) return null;
  const [providerId, ...modelParts] = value.split('::');
  return providerId && modelParts.length ? { providerId, modelId: modelParts.join('::') } : null;
}

function normalizeModel(model) {
  return {
    ...emptyModel(),
    ...model,
    contextWindow: model.contextWindow ?? '',
    maxOutputTokens: model.maxOutputTokens ?? '',
    inputModalities: model.inputModalities || ['text'],
    capabilities: model.capabilities || [],
    reasoningLevels: model.reasoningLevels || [],
    reasoningParameterMap: model.reasoningParameterMap || {},
  };
}

function providerProfileKey(provider) {
  if (!provider) return '';
  return JSON.stringify({
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    enabled: provider.enabled,
    webSearch: provider.webSearch ?? null,
  });
}

const CONNECTION_MESSAGES = {
  succeeded: '连接成功。',
  invalid_credentials: 'API Key 无效或已失效。',
  provider_rejected: '供应商拒绝了这次请求，请检查模型 ID 和接口地址。',
  timed_out: '连接超时，请检查网络或稍后重试。',
  unreachable: '无法连接到供应商，请检查接口地址和网络。',
  invalid_response: '供应商返回了不完整或无法识别的响应。',
  failed: '连接测试失败，请检查供应商配置。',
};

export default function ModelSettingsPanel({ onToast, onDraftChange }) {
  const [catalog, setCatalog] = useState({ providers: [], defaultModel: null, defaultReasoningSelection: API_DEFAULT_REASONING, verifierDefaultModel: null, projectDefaults: {} });
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [providerDraft, setProviderDraft] = useState(null);
  const [providerIsNew, setProviderIsNew] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [modelDraft, setModelDraft] = useState(null);
  const [modelIndex, setModelIndex] = useState(null);
  const [newReasoningLevel, setNewReasoningLevel] = useState('');
  const [defaults, setDefaults] = useState({ primary: '', reasoning: API_DEFAULT_REASONING, verifier: '' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingModelKey, setTestingModelKey] = useState('');
  const [connectionResult, setConnectionResult] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const providerMenuRef = useRef(null);
  const providerMenuButtonRef = useRef(null);

  const selectedProvider = catalog.providers.find((provider) => provider.id === selectedProviderId) || null;
  const providerDraftDirty = providerIsNew
    ? Boolean(providerDraft)
    : Boolean(providerDraft && selectedProvider
      && providerProfileKey(providerDraft) !== providerProfileKey(selectedProvider))
      || apiKeyDraft.length > 0;
  const defaultsDirty = defaults.primary !== refKey(catalog.defaultModel)
    || JSON.stringify(defaults.reasoning)
      !== JSON.stringify(catalog.defaultReasoningSelection || API_DEFAULT_REASONING)
    || defaults.verifier !== refKey(catalog.verifierDefaultModel);
  const hasUnsavedChanges = providerDraftDirty || Boolean(modelDraft) || defaultsDirty;
  const enabledModels = useMemo(() => catalog.providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) => (provider.models || [])
      .filter((model) => model.enabled)
      .map((model) => ({
        key: `${provider.id}::${model.id}`,
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.id,
        modelName: model.name,
        reasoningLevels: model.reasoningLevels || [],
      }))), [catalog.providers]);

  const applyCatalog = (next, preserveDefaults = false) => {
    const value = next?.catalog || next;
    if (!value || !Array.isArray(value.providers)) return;
    setCatalog(value);
    setSelectedProviderId((current) => (
      value.providers.some((provider) => provider.id === current)
        ? current
        : value.providers[0]?.id || ''
    ));
    if (!preserveDefaults) {
      setDefaults({
        primary: refKey(value.defaultModel),
        reasoning: value.defaultReasoningSelection || API_DEFAULT_REASONING,
        verifier: refKey(value.verifierDefaultModel),
      });
    }
    window.dispatchEvent(new CustomEvent('mini-agent-model-catalog-updated'));
  };

  const loadCatalog = async () => {
    setLoading(true);
    try {
      applyCatalog(await api.getModelCatalog());
    } catch (error) {
      onToast?.(`加载模型目录失败：${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadCatalog(); }, []);

  useEffect(() => {
    onDraftChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDraftChange]);

  useEffect(() => {
    setConnectionResult(null);
  }, [selectedProviderId, providerDraftDirty, catalog.providers]);

  useEffect(() => {
    if (!providerMenuOpen) return undefined;
    const closeWhenClickedOutside = (event) => {
      if (!providerMenuRef.current?.contains(event.target)) {
        setProviderMenuOpen(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setProviderMenuOpen(false);
        providerMenuButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeWhenClickedOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeWhenClickedOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [providerMenuOpen]);

  const runMutation = async (operation, fields) => {
    setSaving(true);
    try {
      const preserveDefaults = defaultsDirty && operation !== 'set_defaults';
      const previousDefaults = defaults;
      const result = await api.manageModelCatalog(operation, fields);
      const nextCatalog = result?.catalog || result;
      applyCatalog(result, preserveDefaults);
      if (preserveDefaults && Array.isArray(nextCatalog?.providers)) {
        const available = new Set(nextCatalog.providers
          .filter((provider) => provider.enabled)
          .flatMap((provider) => (provider.models || [])
            .filter((model) => model.enabled)
            .map((model) => `${provider.id}::${model.id}`)));
        const primaryAvailable = available.has(previousDefaults.primary);
        setDefaults({
          primary: primaryAvailable ? previousDefaults.primary : refKey(nextCatalog.defaultModel),
          reasoning: primaryAvailable
            ? previousDefaults.reasoning
            : (nextCatalog.defaultReasoningSelection || API_DEFAULT_REASONING),
          verifier: available.has(previousDefaults.verifier)
            ? previousDefaults.verifier
            : refKey(nextCatalog.verifierDefaultModel),
        });
      }
      onToast?.('模型设置已保存', 'success');
      return true;
    } catch (error) {
      onToast?.(`保存模型设置失败：${error.message}`, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const startProviderDraft = (kind, suggestedName, baseId, suggestedBaseUrl) => {
    const existing = catalog.providers.map((provider) => provider.id);
    let suffix = 1;
    let id = baseId;
    while (existing.includes(id)) id = `${baseId}-${++suffix}`;
    setProviderDraft({ id, name: suggestedName, kind, baseUrl: suggestedBaseUrl, enabled: true, webSearch: null });
    setProviderIsNew(true);
    setApiKeyDraft('');
    setModelDraft(null);
    setSelectedProviderId(id);
  };

  const askConfirmation = (title, message, confirmLabel, action) => {
    setConfirmation({ title, message, confirmLabel, action });
  };

  const discardDrafts = () => {
    setProviderDraft(selectedProvider ? { ...selectedProvider } : null);
    setProviderIsNew(false);
    setApiKeyDraft('');
    setModelDraft(null);
    setModelIndex(null);
    setDefaults({
      primary: refKey(catalog.defaultModel),
      reasoning: catalog.defaultReasoningSelection || API_DEFAULT_REASONING,
      verifier: refKey(catalog.verifierDefaultModel),
    });
  };

  const confirmDiscardAnd = (action) => {
    if (!hasUnsavedChanges) {
      action();
      return;
    }
    askConfirmation(
      '丢弃未保存修改？',
      '供应商、模型或默认值还有未保存的修改。继续后，这些内容会被丢弃。',
      '丢弃修改',
      () => {
        discardDrafts();
        action();
      },
    );
  };

  const resolveConfirmation = async () => {
    const action = confirmation?.action;
    setConfirmation(null);
    await action?.();
  };

  const selectProvider = (provider) => {
    setSelectedProviderId(provider.id);
    setProviderDraft({ ...provider });
    setProviderIsNew(false);
    setApiKeyDraft('');
    setModelDraft(null);
    setModelIndex(null);
  };

  const closeModelEditor = () => {
    if (!modelDraft) return;
    askConfirmation(
      '丢弃未保存模型？',
      '模型修改尚未保存。关闭后，这些修改会被丢弃。',
      '丢弃修改',
      () => { setModelDraft(null); setModelIndex(null); },
    );
  };

  const requestProviderDraft = (kind, name, id, baseUrl) => {
    confirmDiscardAnd(() => startProviderDraft(kind, name, id, baseUrl));
  };

  const saveProvider = async () => {
    const profile = providerDraft || selectedProvider;
    if (!profile) return;
    const fields = {
      provider: {
        id: profile.id,
        name: profile.name,
        kind: profile.kind,
        baseUrl: profile.baseUrl,
        enabled: profile.enabled,
        webSearch: profile.webSearch ?? null,
        models: selectedProvider?.models || [],
      },
    };
    if (apiKeyDraft.length > 0) fields.apiKey = apiKeyDraft;
    if (await runMutation('upsert_provider', fields)) {
      setProviderIsNew(false);
      setApiKeyDraft('');
    }
  };

  const clearApiKey = () => {
    if (!selectedProvider?.apiKeyConfigured) return;
    const profile = {
      id: selectedProvider.id,
      name: selectedProvider.name,
      kind: selectedProvider.kind,
      baseUrl: selectedProvider.baseUrl,
      enabled: selectedProvider.enabled,
      webSearch: selectedProvider.webSearch ?? null,
      models: selectedProvider.models || [],
    };
    askConfirmation(
      '清除 API Key？',
      `将从本机配置中删除“${selectedProvider.name}”的 API Key。`,
      '清除 Key',
      async () => {
        if (await runMutation('upsert_provider', { provider: profile, apiKey: '' })) {
          setApiKeyDraft('');
        }
      },
    );
  };

  const testConnection = async (modelId) => {
    if (!selectedProvider || !modelId) return;
    const providerId = selectedProvider.id;
    const modelKey = `${providerId}::${modelId}`;
    setTestingModelKey(modelKey);
    setConnectionResult(null);
    try {
      const result = await api.manageModelCatalog('test_connection', {
        providerId,
        modelId,
      });
      const status = result?.connectionTest?.status || 'failed';
      const message = CONNECTION_MESSAGES[status] || CONNECTION_MESSAGES.failed;
      setConnectionResult({ providerId, modelId, status, message });
      onToast?.(message, status === 'succeeded' ? 'success' : 'error');
    } catch (error) {
      const message = error?.message || '连接测试失败，请检查供应商配置。';
      setConnectionResult({ providerId, modelId, status: 'failed', message: message.slice(0, 256) });
      onToast?.(message, 'error');
    } finally {
      setTestingModelKey('');
    }
  };

  const saveModel = async () => {
    if (!selectedProvider || !modelDraft) return;
    const model = {
      ...modelDraft,
      contextWindow: modelDraft.contextWindow === '' ? null : Number(modelDraft.contextWindow),
      maxOutputTokens: modelDraft.maxOutputTokens === '' ? null : Number(modelDraft.maxOutputTokens),
    };
    const unmappedLevel = model.reasoningLevels.find((level) => (
      (level === 'disabled' || !STANDARD_REASONING_LEVELS.has(level))
      && !hasParameterMapping(model.reasoningParameterMap?.[level])
    ));
    if (unmappedLevel) {
      onToast?.(`推理等级 ${unmappedLevel} 需要配置供应商对应的参数映射。`, 'warning');
      return;
    }
    const previousModelId = modelIndex === null ? undefined : selectedProvider.models?.[modelIndex]?.id;
    if (await runMutation('upsert_model', {
      providerId: selectedProvider.id,
      ...(previousModelId ? { previousModelId } : {}),
      model,
    })) {
      setModelDraft(null);
      setModelIndex(null);
    }
  };

  const toggleValue = (field, value) => {
    setModelDraft((current) => ({
      ...current,
      [field]: current[field].includes(value)
        ? current[field].filter((item) => item !== value)
        : [...current[field], value],
      smartManaged: false,
    }));
  };

  const applySmartMatch = () => {
    const match = SMART_MATCHES.find((entry) => entry.provider === selectedProvider?.kind
      && entry.id.toLowerCase() === modelDraft.id.trim().toLowerCase());
    if (!match) {
      onToast?.('本地资料库没有精确匹配项，请检查模型 ID 后手动补全参数。', 'info');
      return;
    }
    setModelDraft((current) => ({
      ...current,
      id: match.id,
      name: match.name,
      contextWindow: match.contextWindow ?? current.contextWindow,
      maxOutputTokens: match.maxOutputTokens ?? current.maxOutputTokens,
      inputModalities: match.inputModalities ?? current.inputModalities,
      capabilities: match.capabilities ?? current.capabilities,
      reasoningLevels: match.reasoningLevels ?? current.reasoningLevels,
      reasoningParameterMap: match.reasoningParameterMap ?? current.reasoningParameterMap,
      smartManaged: true,
    }));
  };

  const saveDefaults = async () => {
    const primary = fromRef(defaults.primary);
    const verifier = fromRef(defaults.verifier);
    if (!primary) {
      onToast?.('请先设置一个全局默认模型。', 'warning');
      return;
    }
    if (refKey(primary) === refKey(verifier)) {
      onToast?.('主模型和 Goal Verifier 必须选择不同模型。', 'warning');
      return;
    }
    if (await runMutation('set_defaults', {
      defaultModel: primary,
      defaultReasoningSelection: defaults.reasoning,
      verifierDefaultModel: verifier,
    })) {
      setDefaults((current) => ({ ...current, primary: refKey(primary), verifier: refKey(verifier) }));
    }
  };

  const removeProvider = async () => {
    if (!selectedProvider) return;
    askConfirmation(
      '删除供应商？',
      `将删除“${selectedProvider.name}”及其模型、API Key 和默认值引用。`,
      '删除供应商',
      async () => {
        if (await runMutation('delete_provider', { providerId: selectedProvider.id })) {
          setProviderDraft(null);
          setProviderIsNew(false);
          setApiKeyDraft('');
        }
      },
    );
  };

  const addSuggestedModel = () => {
    const suggestion = SMART_MATCHES.find((item) => item.provider === selectedProvider?.kind);
    if (!suggestion) return;
    const { provider: _provider, ...model } = suggestion;
    setModelIndex(null);
    setModelDraft(normalizeModel({ ...model, enabled: true, smartManaged: true }));
    setNewReasoningLevel('');
  };

  return (
    <div className="model-settings-panel">
      <div className="model-settings-toolbar">
        <div>
          <h2>模型供应商</h2>
          <p>供应商和模型保存在本机。API Key 明文存放于用户配置目录，不加密；Unix 上仅当前用户可读写。</p>
        </div>
        <div className="model-toolbar-actions">
          <button type="button" className="model-icon-button" onClick={() => void loadCatalog()} disabled={loading} title="刷新">
            <RefreshCw size={15} />
          </button>
          <div
            className="model-add-menu"
            ref={providerMenuRef}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setProviderMenuOpen(false);
              }
            }}
          >
            <button
              type="button"
              className="model-primary-button"
              ref={providerMenuButtonRef}
              aria-expanded={providerMenuOpen}
              aria-controls="model-provider-kind-options"
              onClick={() => setProviderMenuOpen((open) => !open)}
              disabled={saving}
            >
              <Plus size={15} /> 添加供应商
            </button>
            <div
              id="model-provider-kind-options"
              className={`model-add-menu-options${providerMenuOpen ? ' open' : ''}`}
              role="group"
              aria-label="选择供应商类型"
            >
              {PROVIDER_KINDS.map(([kind, name, id, baseUrl]) => (
                <button
                  type="button"
                  key={kind}
                  onClick={() => {
                    setProviderMenuOpen(false);
                    providerMenuButtonRef.current?.focus();
                    requestProviderDraft(kind, name, id, baseUrl);
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="model-settings-card">
        <aside className="model-provider-list">
          {catalog.providers.map((provider) => (
            <button
              type="button"
              key={provider.id}
              className={`model-provider-row ${provider.id === selectedProviderId ? 'selected' : ''}`}
              onClick={() => confirmDiscardAnd(() => selectProvider(provider))}
            >
              <span><strong>{provider.name}</strong><small>{provider.models?.length || 0} 个模型</small></span>
              <i className={provider.apiKeyConfigured && provider.baseUrl ? 'ready' : 'needs-config'} />
            </button>
          ))}
          {catalog.providers.length === 0 && <div className="model-empty-providers">添加供应商后配置模型。</div>}
        </aside>

        <section className="model-provider-editor">
          {(providerDraft || selectedProvider) ? (
            <>
              <div className="model-provider-title">
                <div><KeyRound size={19} /><h3>{providerIsNew ? '添加供应商' : (selectedProvider?.name || providerDraft?.name)}</h3></div>
                {!providerIsNew && selectedProvider && <button type="button" className="model-icon-button danger" onClick={() => void removeProvider()} title="删除供应商"><Trash2 size={15} /></button>}
              </div>
              <div className="model-provider-fields">
                <label>供应商名称<input value={providerDraft?.name ?? selectedProvider?.name ?? ''} onChange={(event) => setProviderDraft({ ...(providerDraft || selectedProvider), name: event.target.value })} /></label>
                <label>Base URL<input value={providerDraft?.baseUrl ?? selectedProvider?.baseUrl ?? ''} onChange={(event) => setProviderDraft({ ...(providerDraft || selectedProvider), baseUrl: event.target.value })} placeholder="Responses API 地址前缀" /></label>
                <label>API Key<input type="password" value={apiKeyDraft} onChange={(event) => setApiKeyDraft(event.target.value)} placeholder={selectedProvider?.apiKeyConfigured ? '已配置；输入新值可替换' : '输入 API Key'} autoComplete="new-password" /><small>{selectedProvider?.apiKeyConfigured ? 'API Key 已配置，保存的 Key 不会显示。' : '尚未配置 API Key。'}</small></label>
                <label>供应商搜索能力<select
                  value={(() => {
                    const setting = providerDraft?.webSearch ?? selectedProvider?.webSearch ?? null;
                    return setting === null ? 'auto' : setting ? 'enabled' : 'disabled';
                  })()}
                  onChange={(event) => setProviderDraft({
                    ...(providerDraft || selectedProvider),
                    webSearch: event.target.value === 'auto'
                      ? null
                      : event.target.value === 'enabled',
                  })}
                >
                  <option value="auto">自动，按接口地址判断</option>
                  <option value="enabled">开启</option>
                  <option value="disabled">关闭</option>
                </select></label>
              </div>
              <div className="model-provider-save-row">
                {selectedProvider?.apiKeyConfigured && <button type="button" className="model-text-button" onClick={clearApiKey}>清除 API Key</button>}
                <button type="button" className="model-primary-button" onClick={() => void saveProvider()} disabled={saving || !(providerDraft || selectedProvider)?.name?.trim() || !(providerDraft || selectedProvider)?.baseUrl?.trim()}><Save size={14} />保存供应商</button>
              </div>

              {!providerIsNew && selectedProvider && (
                <div className="model-list-section">
                  <div className="model-list-heading">
                    <div className="model-list-title"><h4>模型列表</h4><small>测试连接会发送一次短请求，可能产生供应商费用。</small></div>
                    <div className="model-row-actions">
                      <button type="button" className="model-secondary-button" onClick={addSuggestedModel} disabled={!SMART_MATCHES.some((item) => item.provider === selectedProvider.kind)}><Sparkles size={14} />添加本地建议</button>
                      <button type="button" className="model-secondary-button" onClick={() => { setModelIndex(null); setModelDraft(emptyModel()); setNewReasoningLevel(''); }}><Plus size={14} />手动添加</button>
                    </div>
                  </div>
                  {(selectedProvider.models || []).length ? (
                    <div className="model-list">
                      {selectedProvider.models.map((model, index) => (
                        <div className="model-list-row" key={`${model.id}-${index}`}>
                          <div className="model-list-model">
                            <div className="model-list-model-heading"><strong>{model.name || model.id}</strong><small>{model.id}</small>{model.smartManaged && <span className="model-smart-badge"><Sparkles size={11} />智能匹配</span>}</div>
                            {connectionResult?.providerId === selectedProvider.id
                              && connectionResult.modelId === model.id
                              && <span className={`model-connection-result ${connectionResult.status}`} role="status">{connectionResult.message}</span>}
                          </div>
                          <div className="model-row-actions">
                            <button
                              type="button"
                              className="model-secondary-button model-test-button"
                              onClick={() => void testConnection(model.id)}
                              disabled={Boolean(testingModelKey) || providerDraftDirty || !selectedProvider.apiKeyConfigured || !selectedProvider.baseUrl || !model.enabled}
                              title={providerDraftDirty ? '请先保存供应商和 API Key。' : '测试连接会发送一次短请求，可能产生供应商费用。'}
                            >
                              {testingModelKey === `${selectedProvider.id}::${model.id}` ? '测试中...' : '测试连接'}
                            </button>
                            <button type="button" className="model-text-button" onClick={() => { setModelIndex(index); setModelDraft(normalizeModel(model)); setNewReasoningLevel(''); }}>编辑</button>
                            <button type="button" className="model-text-button danger" onClick={() => askConfirmation('删除模型？', `将删除模型“${model.name || model.id}”及其默认值引用。`, '删除模型', () => runMutation('delete_model', { providerId: selectedProvider.id, modelId: model.id }))}>删除</button>
                            <label className="model-switch"><input type="checkbox" checked={model.enabled} onChange={() => void runMutation('upsert_model', { providerId: selectedProvider.id, model: { ...model, enabled: !model.enabled } })} /><span /></label>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <div className="model-empty-list">尚未配置模型。可从本地建议添加，或手动填写模型 ID。</div>}
                </div>
              )}
            </>
          ) : <div className="model-empty-providers">从右上角添加一个供应商开始。</div>}
        </section>
      </div>

      <section className="model-defaults-card">
        <div className="model-defaults-title"><div><h3>全局模型默认值</h3><p>Thread 可单独选择模型；没有项目默认值时使用这里的设置。</p></div></div>
        <div className="model-defaults-grid">
          <label>全局默认模型<select value={defaults.primary} onChange={(event) => {
            const primary = event.target.value;
            const selected = enabledModels.find((model) => model.key === primary);
            const currentReasoning = defaults.reasoning;
            const supported = currentReasoning.kind !== 'level'
              || selected?.reasoningLevels.includes(currentReasoning.value);
            setDefaults({
              ...defaults,
              primary,
              reasoning: supported ? currentReasoning : API_DEFAULT_REASONING,
            });
          }}><option value="">选择模型</option>{enabledModels.map((model) => <option key={model.key} value={model.key}>{model.providerName} · {model.modelName}</option>)}</select></label>
          <label>全局默认推理等级<select
            value={reasoningSelectionKey(defaults.reasoning)}
            disabled={!defaults.primary}
            onChange={(event) => setDefaults({ ...defaults, reasoning: reasoningSelectionFromKey(event.target.value) })}
          >
            <option value="api_default">使用 API 默认</option>
            {(enabledModels.find((model) => model.key === defaults.primary)?.reasoningLevels || []).map((level) => (
              <option key={level} value={`level:${level}`}>{reasoningLevelLabel(level)}</option>
            ))}
          </select></label>
          <label>Goal Verifier 默认模型<select value={defaults.verifier} onChange={(event) => setDefaults({ ...defaults, verifier: event.target.value })}><option value="">未配置</option>{enabledModels.filter((model) => model.key !== defaults.primary).map((model) => <option key={model.key} value={model.key}>{model.providerName} · {model.modelName}</option>)}</select></label>
        </div>
        <div className="model-defaults-footer"><span>全局推理等级只对所选默认模型生效；可选择模型等级或使用 API 默认。未配置 Verifier 默认值时，Goal 验证会明确失败，不会复用主模型。</span><button type="button" className="model-primary-button" onClick={() => void saveDefaults()} disabled={saving || enabledModels.length === 0}><Save size={14} />保存默认值</button></div>
      </section>

      {modelDraft && (
        <div className="model-editor-overlay" onClick={closeModelEditor}>
          <div className="model-editor-dialog" onClick={(event) => event.stopPropagation()}>
            <header><h3>{modelIndex === null ? '添加模型' : '编辑模型'}</h3><button type="button" className="model-icon-button" onClick={closeModelEditor} aria-label="关闭模型编辑"><X size={17} /></button></header>
            <div className="model-editor-body">
              <label>模型 ID<div className="model-match-row"><input value={modelDraft.id} onChange={(event) => setModelDraft({ ...modelDraft, id: event.target.value, smartManaged: false })} placeholder="供应商要求的模型 ID" /><button type="button" className="model-secondary-button" onClick={applySmartMatch}><Sparkles size={14} />智能匹配</button></div></label>
              <label>显示名称<input value={modelDraft.name} onChange={(event) => setModelDraft({ ...modelDraft, name: event.target.value, smartManaged: false })} /></label>
              <div className="model-numeric-grid"><label>上下文窗口<input type="number" min="1" value={modelDraft.contextWindow} onChange={(event) => setModelDraft({ ...modelDraft, contextWindow: event.target.value, smartManaged: false })} placeholder="例如 200000" /></label><label>最大输出 Token<input type="number" min="1" value={modelDraft.maxOutputTokens} onChange={(event) => setModelDraft({ ...modelDraft, maxOutputTokens: event.target.value, smartManaged: false })} placeholder="手动填写" /></label></div>
              <fieldset><legend>输入模态</legend><div className="model-chip-list">{MODALITIES.map((item) => <button key={item} type="button" className={modelDraft.inputModalities.includes(item) ? 'active' : ''} onClick={() => toggleValue('inputModalities', item)}>{item}</button>)}</div></fieldset>
              <fieldset><legend>模型能力</legend><div className="model-chip-list">{CAPABILITIES.map((item) => <button key={item} type="button" className={modelDraft.capabilities.includes(item) ? 'active' : ''} onClick={() => toggleValue('capabilities', item)}>{item}</button>)}</div></fieldset>
              <fieldset>
                <legend>推理等级</legend>
                <div className="model-chip-list">
                  {[...new Set([...REASONING_LEVELS, ...modelDraft.reasoningLevels])].map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={modelDraft.reasoningLevels.includes(item) ? 'active' : ''}
                      onClick={() => toggleValue('reasoningLevels', item)}
                    >
                      {reasoningLevelLabel(item)}
                    </button>
                  ))}
                </div>
                <div className="model-reasoning-level-editor">
                  <input
                    aria-label="自定义推理等级"
                    value={newReasoningLevel}
                    onChange={(event) => setNewReasoningLevel(event.target.value)}
                    placeholder="自定义等级 ID"
                  />
                  <button
                    type="button"
                    className="model-secondary-button"
                    onClick={() => {
                      const level = newReasoningLevel.trim();
                      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(level)) {
                        onToast?.('推理等级需为 1–64 位字母、数字、点、下划线或短横线。', 'warning');
                        return;
                      }
                      if (modelDraft.reasoningLevels.includes(level)) {
                        onToast?.('该推理等级已存在。', 'info');
                        return;
                      }
                      setModelDraft((current) => ({
                        ...current,
                        reasoningLevels: [...current.reasoningLevels, level],
                        smartManaged: false,
                      }));
                      setNewReasoningLevel('');
                    }}
                  >
                    <Plus size={13} />添加等级
                  </button>
                </div>
                <small>这里配置 Thread 可选的等级。disabled 和自定义等级需在参数映射中设置供应商对应的请求参数。</small>
              </fieldset>
              <label>推理参数映射（JSON）<textarea rows="5" value={JSON.stringify(modelDraft.reasoningParameterMap, null, 2)} onChange={(event) => { try { setModelDraft({ ...modelDraft, reasoningParameterMap: JSON.parse(event.target.value), smartManaged: false }); } catch { setModelDraft({ ...modelDraft, reasoningParameterMap: event.target.value, smartManaged: false }); } }} /></label>
              {typeof modelDraft.reasoningParameterMap === 'string' && <span className="model-form-error">请输入合法 JSON 对象</span>}
            </div>
            <footer><span>{modelDraft.smartManaged ? '本地资料匹配；手动修改后将转为手动管理。' : '模型能力由本地配置决定。'}</span><button type="button" className="model-primary-button" onClick={() => void saveModel()} disabled={saving || !modelDraft.id.trim() || !modelDraft.name.trim() || typeof modelDraft.reasoningParameterMap === 'string'}><Save size={14} />保存模型</button></footer>
          </div>
        </div>
      )}

      {confirmation && (
        <div className="model-confirm-overlay" role="presentation" onClick={() => setConfirmation(null)}>
          <div className="model-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="model-confirm-title" onClick={(event) => event.stopPropagation()}>
            <h3 id="model-confirm-title">{confirmation.title}</h3>
            <p>{confirmation.message}</p>
            <div className="model-confirm-actions">
              <button type="button" className="model-secondary-button" onClick={() => setConfirmation(null)}>取消</button>
              <button type="button" className="model-primary-button" onClick={() => void resolveConfirmation()}>{confirmation.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
