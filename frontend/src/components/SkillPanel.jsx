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
  const groupsById = useMemo(
    () => new Map(groups.map((group) => [String(group.id), group])),
    [groups],
  );
  const visibleSkills = useMemo(() => skills.filter((skill) => (
    !normalizedQuery
      || skill.name?.toLowerCase().includes(normalizedQuery)
      || skill.qualifiedName?.toLowerCase().includes(normalizedQuery)
      || skill.aliases?.some((alias) => alias.toLowerCase().includes(normalizedQuery))
      || skill.description?.toLowerCase().includes(normalizedQuery)
  )), [skills, normalizedQuery]);
  const groupedSkills = useMemo(() => {
    const skillsByGroup = new Map();
    for (const skill of visibleSkills) {
      const id = skill.group || skill.source || 'other';
      if (!skillsByGroup.has(id)) skillsByGroup.set(id, []);
      skillsByGroup.get(id).push(skill);
    }
    const orderedIds = [
      ...groups.map((group) => String(group.id)),
      ...[...skillsByGroup.keys()].filter((id) => !groupsById.has(id)),
    ];
    return orderedIds.map((id) => [id, skillsByGroup.get(id) || []]);
  }, [groups, groupsById, visibleSkills]);
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
      <div className="skill-panel-guide">
        <div className="skill-panel-guide-title">
          <strong>两种调用方式</strong>
          <span>技能组来自当前 Project 的运行时 Catalog，不会自动加载所有正文。</span>
        </div>
        <div className="skill-activation-row">
          <code>+ {'<group>'}</code>
          <span>组级工作流：当前 Turn 开启整组，由模型根据技能简介按需挑选和读取。</span>
          <span className="skill-capability-badge auto">按需</span>
        </div>
        <div className="skill-activation-row">
          <code>${'<group>:<skill>'}</code>
          <span>Skill 级调用：当前 Turn 直接加载指定技能正文，也支持面板点击插入。</span>
          <span className="skill-capability-badge explicit">直接</span>
        </div>
      </div>
      {groups.map((group) => {
        const groupId = String(group.id);
        const groupSkills = skills.filter((skill) => skill.group === groupId);
        const enabled = group.enabled !== false;
        return (
          <div className="skill-group-toggle" key={groupId}>
            <div className="skill-group-identity">
              <div className="skill-group-name">
                <Sparkles size={13} className="text-purple" />
                <strong>{group.label || groupId}</strong>
                <span className={`skill-group-status ${enabled ? 'enabled' : 'disabled'}`}>
                  {enabled ? '已启用' : '已关闭'}
                </span>
              </div>
              <span>v{group.version || '未知'} · {groupSkills.length} 项组内技能 · {enabled ? '可用于 + 和 $' : '已从当前项目目录禁用'}</span>
              <div className="skill-group-capabilities">
                <span className="skill-capability-badge auto">+ {groupId} · 组内按需</span>
                <span className={`skill-capability-badge explicit ${enabled ? '' : 'disabled'}`}>${groupId}:skill · 直接调用</span>
              </div>
            </div>
            <button
              type="button"
              className={`btn-toggle-switch ${enabled ? 'on' : 'off'}`}
              onClick={() => onToggleGroup?.(groupId, !enabled)}
              aria-pressed={enabled}
            >
              {enabled ? '关闭' : '启用'}
            </button>
          </div>
        );
      })}
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
      {!loading && !error && groups.some((group) => (
        group.enabled !== false && !skills.some((skill) => skill.group === group.id)
      )) && (
        <div className="skill-panel-warning" role="alert">
          <strong>部分技能组的明细暂不可用</strong>
          <span>runtime 只返回了组状态，没有返回对应 Skill catalog。请刷新或重启当前项目 runtime。</span>
        </div>
      )}
      {!loading && !error && (
        <div className="skill-list">
          {groupedSkills.map(([groupId, groupSkills]) => (
            <section key={groupId} className="skill-group-section">
              <div className="skill-group-heading">
                <span className="skill-group-heading-label"><Sparkles size={11} /> {groupsById.get(groupId)?.label || `${groupId} · 内置技能组`}</span>
                <span className="skill-group-heading-count">{groupSkills.length} 项</span>
              </div>
              <div className="skill-group-section-guide">
                下面每项都可以用 <code>${groupId}:技能名</code> 直接调用，也可能在 <code>+ {groupId}</code> 中被模型按需选中；点击卡片插入规范名。
              </div>
              {groupSkills.map((skill) => {
                const groupEnabled = groupsById.has(groupId) && groupsById.get(groupId).enabled !== false;
                const enabled = skill.enabled !== false && groupEnabled;
                return (
                <button
                  type="button"
                  key={`${skill.source}-${skill.name}`}
                  className={`skill-card ${enabled ? '' : 'disabled'}`}
                  disabled={!enabled}
                  onClick={() => onInsertSkill?.(skill.qualifiedName || skill.name)}
                  title={!enabled ? '技能组已关闭或技能不可用' : `插入 $${skill.qualifiedName || skill.name}`}
                >
                  <div className="skill-card-title">
                    <span className="skill-card-name font-mono">${skill.qualifiedName || skill.name}</span>
                    <span className="skill-card-source">{skill.source}</span>
                  </div>
                  <div className="skill-card-description">{skill.description || '暂无技能简介'}</div>
                  <div className="skill-card-capabilities">
                    <span className={`skill-capability-badge explicit ${enabled ? '' : 'disabled'}`}>$ 直接调用</span>
                    <span className={`skill-capability-badge auto ${enabled ? '' : 'disabled'}`}>+ {groupId} 按需</span>
                  </div>
                  {Array.isArray(skill.aliases) && skill.aliases.length > 0 && (
                    <div className="skill-card-aliases">
                      <span>兼容别名</span>
                      {skill.aliases.map((alias) => <span key={alias} className="font-mono">${alias}</span>)}
                    </div>
                  )}
                </button>
                );
              })}
            </section>
          ))}
          {visibleSkills.length === 0 && <div className="loading-placeholder">没有匹配的技能</div>}
        </div>
      )}
    </div>
  );
}
