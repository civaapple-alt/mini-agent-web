import React, { useEffect, useMemo, useState } from 'react';
import { KeyRound, Plus, RefreshCw, Save, Sparkles, Trash2, X } from 'lucide-react';
import { api } from '../api';
import './ModelSettingsPanel.css';

const PROVIDER_KINDS = [
  ['deepseek', 'DeepSeek', 'deepseek'],
  ['kimi', 'Kimi', 'kimi'],
  ['glm', 'GLM / Z.ai', 'glm'],
  ['volcengine', '字节火山 / Volcengine', 'volcengine'],
  ['custom', '自定义 Responses', 'custom'],
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

export default function ModelSettingsPanel({ projectId = null, onToast }) {
  const [catalog, setCatalog] = useState({ providers: [], defaultModel: null, defaultReasoningSelection: API_DEFAULT_REASONING, verifierDefaultModel: null, projectDefaults: {} });
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [providerDraft, setProviderDraft] = useState(null);
  const [providerIsNew, setProviderIsNew] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [modelDraft, setModelDraft] = useState(null);
  const [modelIndex, setModelIndex] = useState(null);
  const [newReasoningLevel, setNewReasoningLevel] = useState('');
  const [defaults, setDefaults] = useState({ primary: '', reasoning: API_DEFAULT_REASONING, verifier: '', project: '' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedProvider = catalog.providers.find((provider) => provider.id === selectedProviderId) || null;
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

  const applyCatalog = (next) => {
    const value = next?.catalog || next;
    if (!value || !Array.isArray(value.providers)) return;
    setCatalog(value);
    setSelectedProviderId((current) => (
      value.providers.some((provider) => provider.id === current)
        ? current
        : value.providers[0]?.id || ''
    ));
    setDefaults({
      primary: refKey(value.defaultModel),
      reasoning: value.defaultReasoningSelection || API_DEFAULT_REASONING,
      verifier: refKey(value.verifierDefaultModel),
      project: refKey(value.projectDefaults?.[projectId]),
    });
    window.dispatchEvent(new CustomEvent('mini-agent-model-catalog-updated'));
  };

  const loadCatalog = async () => {
    setLoading(true);
    try {
      applyCatalog(await api.getModelCatalog({ projectId }));
    } catch (error) {
      onToast?.(`加载模型目录失败：${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadCatalog(); }, [projectId]);

  const runMutation = async (operation, fields) => {
    setSaving(true);
    try {
      applyCatalog(await api.manageModelCatalog(operation, fields, { projectId }));
      onToast?.('模型设置已保存', 'success');
      return true;
    } catch (error) {
      onToast?.(`保存模型设置失败：${error.message}`, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const startProviderDraft = (kind, suggestedName, baseId) => {
    const existing = catalog.providers.map((provider) => provider.id);
    let suffix = 1;
    let id = baseId;
    while (existing.includes(id)) id = `${baseId}-${++suffix}`;
    setProviderDraft({ id, name: suggestedName, kind, baseUrl: '', enabled: true });
    setProviderIsNew(true);
    setApiKeyDraft('');
    setSelectedProviderId(id);
  };

  const saveProvider = async () => {
    const profile = providerDraft || selectedProvider;
    if (!profile) return;
    const fields = {
      provider: { ...profile, models: selectedProvider?.models || [] },
    };
    if (apiKeyDraft.length > 0) fields.apiKey = apiKeyDraft;
    if (await runMutation('upsert_provider', fields)) {
      setProviderIsNew(false);
      setApiKeyDraft('');
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
      const projectDefault = fromRef(defaults.project);
      if (projectId) {
        await runMutation('set_project_default', { projectId, projectDefault });
      }
    }
  };

  const removeProvider = async () => {
    if (!selectedProvider) return;
    if (!window.confirm(`删除供应商“${selectedProvider.name}”及其模型配置？`)) return;
    if (await runMutation('delete_provider', { providerId: selectedProvider.id })) {
      setProviderDraft(null);
      setProviderIsNew(false);
    }
  };

  return (
    <div className="model-settings-panel">
      <div className="model-settings-toolbar">
        <div>
          <h2>模型供应商</h2>
          <p>供应商和模型元数据保存在本机，API Key 由系统凭据库保管。</p>
        </div>
        <div className="model-toolbar-actions">
          <button type="button" className="model-icon-button" onClick={() => void loadCatalog()} disabled={loading} title="刷新">
            <RefreshCw size={15} />
          </button>
          <div className="model-add-menu">
            <button type="button" className="model-primary-button" disabled={saving}>
              <Plus size={15} /> 添加供应商
            </button>
            <div className="model-add-menu-options">
              {PROVIDER_KINDS.map(([kind, name, id]) => (
                <button type="button" key={kind} onClick={() => startProviderDraft(kind, name, id)}>{name}</button>
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
              onClick={() => { setSelectedProviderId(provider.id); setProviderDraft({ ...provider }); setProviderIsNew(false); setApiKeyDraft(''); }}
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
                <label>Base URL<input value={providerDraft?.baseUrl ?? selectedProvider?.baseUrl ?? ''} onChange={(event) => setProviderDraft({ ...(providerDraft || selectedProvider), baseUrl: event.target.value })} placeholder="请填写 Responses API 的 URL 前缀" /></label>
                <label>API Key<input type="password" value={apiKeyDraft} onChange={(event) => setApiKeyDraft(event.target.value)} placeholder={selectedProvider?.apiKeyConfigured ? '已配置；输入新值可替换' : '输入 API Key'} autoComplete="new-password" /></label>
              </div>
              <div className="model-provider-save-row">
                {selectedProvider?.apiKeyConfigured && <button type="button" className="model-text-button" onClick={() => { setApiKeyDraft(''); void runMutation('upsert_provider', { provider: { ...selectedProvider, apiKeyConfigured: undefined }, apiKey: '' }); }}>清除 API Key</button>}
                <button type="button" className="model-primary-button" onClick={() => void saveProvider()} disabled={saving || !(providerDraft || selectedProvider)}><Save size={14} />保存供应商</button>
              </div>

              {!providerIsNew && selectedProvider && (
                <div className="model-list-section">
                  <div className="model-list-heading"><h4>模型列表</h4><button type="button" className="model-secondary-button" onClick={() => { setModelIndex(null); setModelDraft(emptyModel()); setNewReasoningLevel(''); }}><Plus size={14} /> 添加模型</button></div>
                  {(selectedProvider.models || []).length ? (
                    <div className="model-list">
                      {selectedProvider.models.map((model, index) => (
                        <div className="model-list-row" key={`${model.id}-${index}`}>
                          <div><strong>{model.name || model.id}</strong><small>{model.id}</small>{model.smartManaged && <span className="model-smart-badge"><Sparkles size={11} />智能匹配</span>}</div>
                          <div className="model-row-actions">
                            <button type="button" className="model-text-button" onClick={() => { setModelIndex(index); setModelDraft(normalizeModel(model)); setNewReasoningLevel(''); }}>编辑</button>
                            <button type="button" className="model-text-button danger" onClick={() => void runMutation('delete_model', { providerId: selectedProvider.id, modelId: model.id })}>删除</button>
                            <label className="model-switch"><input type="checkbox" checked={model.enabled} onChange={() => void runMutation('upsert_model', { providerId: selectedProvider.id, model: { ...model, enabled: !model.enabled } })} /><span /></label>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <div className="model-empty-list">尚未配置模型，添加后即可设置默认模型。</div>}
                </div>
              )}
            </>
          ) : <div className="model-empty-providers">从右上角添加一个供应商开始。</div>}
        </section>
      </div>

      <section className="model-defaults-card">
        <div className="model-defaults-title"><div><h3>模型默认值</h3><p>Thread 显式选择优先，其次项目默认，再使用全局默认。</p></div></div>
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
          {projectId && <label>当前项目默认模型<select value={defaults.project} onChange={(event) => setDefaults({ ...defaults, project: event.target.value })}><option value="">继承全局默认</option>{enabledModels.map((model) => <option key={model.key} value={model.key}>{model.providerName} · {model.modelName}</option>)}</select></label>}
        </div>
        <div className="model-defaults-footer"><span>全局推理等级只对所选默认模型生效；可选择模型等级或使用 API 默认。未配置 Verifier 默认值时，Goal 验证会明确失败，不会复用主模型。</span><button type="button" className="model-primary-button" onClick={() => void saveDefaults()} disabled={saving || enabledModels.length === 0}><Save size={14} />保存默认值</button></div>
      </section>

      {modelDraft && (
        <div className="model-editor-overlay" onClick={() => { setModelDraft(null); setModelIndex(null); }}>
          <div className="model-editor-dialog" onClick={(event) => event.stopPropagation()}>
            <header><h3>{modelIndex === null ? '添加模型' : '编辑模型'}</h3><button type="button" className="model-icon-button" onClick={() => { setModelDraft(null); setModelIndex(null); }}><X size={17} /></button></header>
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
    </div>
  );
}
