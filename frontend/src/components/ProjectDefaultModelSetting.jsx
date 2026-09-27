import React, { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { api } from '../api';

function selectionKey(selection) {
  return selection ? `${selection.providerId || selection.provider_id}::${selection.modelId || selection.model_id}` : '';
}

function selectionFromKey(value) {
  if (!value) return null;
  const [providerId, ...modelParts] = value.split('::');
  return providerId && modelParts.length
    ? { providerId, modelId: modelParts.join('::') }
    : null;
}

export default function ProjectDefaultModelSetting({ projectId, onToast, onDirtyChange, onOpenSettings }) {
  const [catalog, setCatalog] = useState({ providers: [], projectDefaults: {} });
  const [selection, setSelection] = useState('');
  const [savedSelection, setSavedSelection] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const models = useMemo(() => (catalog.providers || [])
    .filter((provider) => provider.enabled && provider.apiKeyConfigured && provider.baseUrl?.trim())
    .flatMap((provider) => (provider.models || [])
      .filter((model) => model.enabled)
      .map((model) => ({
        key: `${provider.id}::${model.id}`,
        label: `${provider.name} · ${model.name || model.id}`,
      }))), [catalog.providers]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    api.getModelCatalog()
      .then((result) => {
        const value = result?.catalog || result;
        if (!current || !Array.isArray(value?.providers)) return;
        const configured = selectionKey(value.projectDefaults?.[projectId]);
        setCatalog(value);
        setSelection(configured);
        setSavedSelection(configured);
      })
      .catch((error) => onToast?.(`加载项目模型设置失败：${error.message}`, 'error'))
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [projectId, onToast]);

  const dirty = selection !== savedSelection;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const save = async () => {
    setSaving(true);
    try {
      const result = await api.manageModelCatalog('set_project_default', {
        projectId,
        projectDefault: selectionFromKey(selection),
      }, { projectId });
      const value = result?.catalog || result;
      setCatalog(value);
      setSavedSelection(selection);
      onDirtyChange?.(false);
      window.dispatchEvent(new CustomEvent('mini-agent-model-catalog-updated'));
      onToast?.('项目默认模型已保存', 'success');
    } catch (error) {
      onToast?.(`保存项目默认模型失败：${error.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="project-model-default-card" aria-label="项目默认模型设置">
      <div>
        <h3>项目默认模型</h3>
        <p>该项目的新 Thread 会优先使用这里的模型。清空后继承全局默认。</p>
      </div>
      {loading ? (
        <span className="project-model-default-empty">正在读取模型设置…</span>
      ) : models.length ? (
        <>
          <label>
            项目默认模型
            <select aria-label="项目默认模型" value={selection} onChange={(event) => setSelection(event.target.value)}>
              <option value="">继承全局默认</option>
              {models.map((model) => <option key={model.key} value={model.key}>{model.label}</option>)}
            </select>
          </label>
          <div className="project-model-default-actions">
            <button type="button" className="btn-save-project-primary" onClick={() => void save()} disabled={!dirty || saving}>
              <Save size={14} />{saving ? '保存中…' : '保存项目默认模型'}
            </button>
          </div>
        </>
      ) : (
        <div className="project-model-default-empty">
          <span>请先添加供应商和模型。</span>
          <button type="button" className="btn-text-manual" onClick={() => onOpenSettings?.('models')}>打开模型设置</button>
        </div>
      )}
    </section>
  );
}
