import React, { useMemo, useState } from 'react';
import { Search, Sparkles, X } from 'lucide-react';

export default function SkillPanel({
  skills = [],
  groups = [],
  loading = false,
  error = null,
  onToggleGroup,
  onInsertSkill,
}) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSkills = useMemo(() => skills.filter((skill) => (
    !normalizedQuery
      || skill.name?.toLowerCase().includes(normalizedQuery)
      || skill.qualifiedName?.toLowerCase().includes(normalizedQuery)
      || skill.aliases?.some((alias) => alias.toLowerCase().includes(normalizedQuery))
      || skill.description?.toLowerCase().includes(normalizedQuery)
  )), [skills, normalizedQuery]);
  const groupedSkills = useMemo(() => {
    const groupsById = new Map();
    for (const skill of visibleSkills) {
      const id = skill.group || skill.source || 'other';
      if (!groupsById.has(id)) groupsById.set(id, []);
      groupsById.get(id).push(skill);
    }
    return [...groupsById.entries()];
  }, [visibleSkills]);
  const pstack = groups.find((group) => group.id === 'pstack') || {
    id: 'pstack', version: '0.2.0', enabled: skills.some((skill) => skill.group === 'pstack' && skill.enabled),
  };
  const enabledCount = skills.filter((skill) => skill.enabled !== false).length;

  return (
    <div className="tab-pane skill-panel">
      <div className="pane-section-header">
        <span className="section-title"><Sparkles size={14} className="text-purple" /> 可用技能</span>
        <span className="skill-panel-count font-mono">{enabledCount}/{skills.length} 已启用</span>
      </div>
      <div className="skill-panel-intro">
        <span>技能只在提交当前 Turn 时加载，不会改变全局提示词。</span>
        <span className="font-mono">输入 $ 开始搜索</span>
      </div>
      <div className="skill-group-toggle">
        <div className="skill-group-identity">
          <div className="skill-group-name">
            <Sparkles size={13} className="text-purple" />
            <strong>pstack</strong>
            <span className={`skill-group-status ${pstack.enabled ? 'enabled' : 'disabled'}`}>
              {pstack.enabled ? '已启用' : '已关闭'}
            </span>
          </div>
          <span>v{pstack.version} · Engineering agent workflows · {pstack.enabled ? '可用于 + 和 $' : '已从当前项目目录禁用'}</span>
        </div>
        <button
          type="button"
          className={`btn-toggle-switch ${pstack.enabled ? 'on' : 'off'}`}
          onClick={() => onToggleGroup?.('pstack', !pstack.enabled)}
          aria-pressed={pstack.enabled}
        >
          {pstack.enabled ? '关闭' : '启用'}
        </button>
      </div>
      <div className="skill-panel-toolbar">
        <label className="skill-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索名称、规范名、别名或简介"
            aria-label="搜索技能"
          />
          {query && (
            <button
              type="button"
              className="skill-search-clear"
              onClick={() => setQuery('')}
              aria-label="清除技能搜索"
              title="清除搜索"
            >
              <X size={12} />
            </button>
          )}
        </label>
        <div className="skill-panel-summary">
          <span>{normalizedQuery ? `匹配 ${visibleSkills.length} 项` : `共 ${skills.length} 项`}</span>
          <span className="font-mono">点击技能插入 $skill</span>
        </div>
      </div>
      {loading && <div className="loading-placeholder font-mono">技能目录加载中...</div>}
      {error && <div className="skill-panel-error">{error}</div>}
      {!loading && !error && (
        <div className="skill-list">
          {groupedSkills.map(([groupId, groupSkills]) => (
            <section key={groupId} className="skill-group-section">
              <div className="skill-group-heading">
                <span><Sparkles size={11} /> {groupId}</span>
                <span>{groupSkills.length} 项</span>
              </div>
              {groupSkills.map((skill) => (
                <button
                  type="button"
                  key={`${skill.source}-${skill.name}`}
                  className={`skill-card ${skill.enabled === false ? 'disabled' : ''}`}
                  disabled={skill.enabled === false}
                  onClick={() => onInsertSkill?.(skill.qualifiedName || skill.name)}
                  title={skill.enabled === false ? '技能组已关闭' : `插入 $${skill.qualifiedName || skill.name}`}
                >
                  <div className="skill-card-title">
                    <span className="skill-card-name font-mono">${skill.qualifiedName || skill.name}</span>
                    <span className="skill-card-source">{skill.source}</span>
                  </div>
                  <div className="skill-card-description">{skill.description || '暂无技能简介'}</div>
                  {Array.isArray(skill.aliases) && skill.aliases.length > 0 && (
                    <div className="skill-card-aliases">
                      <span>别名</span>
                      {skill.aliases.map((alias) => <span key={alias} className="font-mono">${alias}</span>)}
                    </div>
                  )}
                </button>
              ))}
            </section>
          ))}
          {visibleSkills.length === 0 && <div className="loading-placeholder">没有匹配的技能</div>}
        </div>
      )}
    </div>
  );
}
