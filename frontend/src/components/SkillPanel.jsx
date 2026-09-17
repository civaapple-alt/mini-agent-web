import React, { useMemo, useState } from 'react';
import { Search, Sparkles } from 'lucide-react';

export default function SkillPanel({
  skills = [],
  groups = [],
  loading = false,
  error = null,
  onToggleGroup,
  onInsertSkill,
}) {
  const [query, setQuery] = useState('');
  const visibleSkills = useMemo(() => skills.filter((skill) => (
    !query
      || skill.name?.toLowerCase().includes(query.toLowerCase())
      || skill.description?.toLowerCase().includes(query.toLowerCase())
  )), [skills, query]);
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

  return (
    <div className="tab-pane skill-panel">
      <div className="pane-section-header">
        <span className="section-title"><Sparkles size={14} className="text-purple" /> 可用技能</span>
        <span className="skill-panel-count font-mono">{skills.length}/64</span>
      </div>
      <div className="skill-group-toggle">
        <div>
          <strong>pstack</strong>
          <span>v{pstack.version} · {pstack.enabled ? '已启用' : '已关闭'}</span>
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
      <label className="skill-search">
        <Search size={13} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索技能名称或简介" />
      </label>
      {loading && <div className="loading-placeholder font-mono">技能目录加载中...</div>}
      {error && <div className="skill-panel-error">{error}</div>}
      {!loading && !error && (
        <div className="skill-list">
          {groupedSkills.map(([groupId, groupSkills]) => (
            <section key={groupId} className="skill-group-section">
              <div className="skill-group-heading">{groupId}</div>
              {groupSkills.map((skill) => (
                <button
                  type="button"
                  key={`${skill.source}-${skill.name}`}
                  className={`skill-card ${skill.enabled === false ? 'disabled' : ''}`}
                  disabled={skill.enabled === false}
                  onClick={() => onInsertSkill?.(skill.name)}
                  title={skill.enabled === false ? '技能组已关闭' : `插入 $${skill.name}`}
                >
                  <div className="skill-card-title"><span className="font-mono">${skill.name}</span><span>{skill.source}</span></div>
                  <div className="skill-card-description">{skill.description}</div>
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
