import React, { useMemo, useState } from 'react';
import { Search, Sparkles, X } from 'lucide-react';

const ORIGIN_FILTERS = [
  { id: 'builtin_group', label: '内置' },
  { id: 'user_agents', label: '~/.agents' },
  { id: 'user_mini_agent', label: '~/.mini-agent' },
  { id: 'project', label: '项目' },
  { id: 'plugin', label: '插件' },
  { id: 'user_unknown', label: '个人来源未细分' },
  { id: 'unknown', label: '其他来源' },
];

const ORIGIN_LABELS = {
  builtin_group: '内置技能组',
  user_agents: '个人技能 · ~/.agents/skills',
  user_mini_agent: '个人技能 · ~/.mini-agent/skills',
  project: '项目技能 · .agents/skills',
  plugin: '插件技能 · .agents/plugins',
  user_unknown: '个人目录技能 · 来源未细分',
  unknown: '来源未细分',
};

function getSkillOrigin(skill) {
  const knownOrigin = ORIGIN_FILTERS.some(({ id }) => id === skill.origin);
  if (knownOrigin) return skill.origin;
  if (skill.source === 'builtin' && skill.group) return 'builtin_group';
  if (skill.source === 'project' || skill.source === 'plugin') return skill.source;
  if (skill.source === 'user') return 'user_unknown';
  return 'unknown';
}

function isBuiltinGroupSkill(skill, groupsById) {
  if (!skill.group || !groupsById.has(String(skill.group))) return false;
  if (skill.origin) return skill.origin === 'builtin_group';
  return skill.source === 'builtin';
}

function isSkillEnabled(skill, groupsById) {
  if (skill.enabled === false) return false;
  if (!isBuiltinGroupSkill(skill, groupsById)) return true;
  return groupsById.get(String(skill.group)).enabled !== false;
}

export default function SkillPanel({
  skills = [],
  groups = [],
  loading = false,
  error = null,
  onToggleGroup,
  onInsertSkill,
}) {
  const [query, setQuery] = useState('');
  const [selectedOrigin, setSelectedOrigin] = useState('all');
  const normalizedQuery = query.trim().toLowerCase();
  const groupsById = useMemo(
    () => new Map(groups.map((group) => [String(group.id), group])),
    [groups],
  );
  const originCounts = useMemo(() => {
    const counts = new Map();
    for (const skill of skills) {
      const origin = getSkillOrigin(skill);
      counts.set(origin, (counts.get(origin) || 0) + 1);
    }
    return counts;
  }, [skills]);
  const visibleOrigins = useMemo(
    () => ORIGIN_FILTERS.filter(({ id }) => (
      originCounts.has(id) || (id === 'builtin_group' && groups.length > 0)
    )),
    [groups.length, originCounts],
  );
  const visibleSkills = useMemo(() => skills.filter((skill) => {
    const origin = getSkillOrigin(skill);
    const matchesOrigin = selectedOrigin === 'all' || origin === selectedOrigin;
    const aliases = Array.isArray(skill.aliases) ? skill.aliases : [];
    const searchableText = [
      skill.name,
      skill.qualifiedName,
      skill.description,
      ...aliases,
    ].filter((value) => typeof value === 'string').join('\n').toLowerCase();
    return matchesOrigin && (!normalizedQuery || searchableText.includes(normalizedQuery));
  }), [skills, normalizedQuery, selectedOrigin]);
  const groupedSkills = useMemo(() => {
    const byOrigin = new Map();
    for (const skill of visibleSkills) {
      const origin = getSkillOrigin(skill);
      if (!byOrigin.has(origin)) byOrigin.set(origin, []);
      byOrigin.get(origin).push(skill);
    }
    const order = ORIGIN_FILTERS.map(({ id }) => id);
    const originIds = [...byOrigin.keys()].sort((left, right) => (
      order.indexOf(left) - order.indexOf(right)
    ));
    return originIds.map((origin) => [origin, byOrigin.get(origin)]);
  }, [visibleSkills]);
  const enabledCount = skills.filter((skill) => isSkillEnabled(skill, groupsById)).length;

  return (
    <div className="tab-pane skill-panel">
      <div className="pane-section-header">
        <span className="section-title"><Sparkles size={14} className="text-purple" /> 可用技能</span>
        <span className="skill-panel-count font-mono">{enabledCount}/{skills.length} 已启用</span>
      </div>
      <div className="skill-panel-intro">
        <span>按名称或来源查找；点击技能可插入调用名。</span>
        <span className="font-mono">别名也可搜索</span>
      </div>
      <div className="skill-panel-toolbar">
        <label className="skill-search">
          <Search size={13} aria-hidden="true" />
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
        <span className="skill-panel-summary">
          {normalizedQuery ? `匹配 ${visibleSkills.length} 项` : `共 ${skills.length} 项`}
        </span>
      </div>
      <div className="skill-origin-filters" role="group" aria-label="筛选技能来源">
        <button
          type="button"
          className={`skill-origin-filter ${selectedOrigin === 'all' ? 'active' : ''}`}
          onClick={() => setSelectedOrigin('all')}
          aria-pressed={selectedOrigin === 'all'}
        >
          全部 <span>{skills.length}</span>
        </button>
        {visibleOrigins.map(({ id, label }) => (
          <button
            type="button"
            key={id}
            className={`skill-origin-filter ${selectedOrigin === id ? 'active' : ''}`}
            onClick={() => setSelectedOrigin(id)}
            aria-pressed={selectedOrigin === id}
          >
            {label} <span>{originCounts.get(id) ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="skill-panel-call-hint">
        点卡片插入 <code>$skill</code>；带内置组标记的技能也可用 <code>+ group</code> 按需调用。
      </div>
      {selectedOrigin === 'builtin_group' && groups.length > 0 && (
        <details className="skill-group-settings">
          <summary>
            <span>内置技能组</span>
            <span>{groups.length} 组 · 展开管理启用状态</span>
          </summary>
          <div className="skill-group-settings-list">
            {groups.map((group) => {
              const groupId = String(group.id);
              const groupSkills = skills.filter((skill) => (
                isBuiltinGroupSkill(skill, groupsById) && String(skill.group) === groupId
              ));
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
                    <span>{group.version ? `v${group.version} · ` : ''}{groupSkills.length} 项组内技能</span>
                  </div>
                  <button
                    type="button"
                    className={`btn-toggle-switch ${enabled ? 'on' : 'off'}`}
                    onClick={() => onToggleGroup?.(groupId, !enabled)}
                    aria-pressed={enabled}
                    aria-label={`${enabled ? '关闭' : '启用'}技能组 ${group.label || groupId}`}
                  >
                    {enabled ? '关闭' : '启用'}
                  </button>
                </div>
              );
            })}
          </div>
        </details>
      )}
      {loading && <div className="loading-placeholder font-mono">技能目录加载中...</div>}
      {error && <div className="skill-panel-error" role="alert">{error}</div>}
      {!loading && !error && groups.some((group) => (
        group.enabled !== false && !skills.some((skill) => (
          isBuiltinGroupSkill(skill, groupsById) && String(skill.group) === String(group.id)
        ))
      )) && selectedOrigin === 'builtin_group' && (
        <div className="skill-panel-warning" role="alert">
          <strong>部分技能组的明细暂不可用</strong>
          <span>runtime 只返回了组状态，没有返回对应 Skill catalog。请刷新或重启当前项目 runtime。</span>
        </div>
      )}
      {!loading && !error && (
        <div className="skill-list">
          {groupedSkills.map(([origin, originSkills]) => (
            <section key={origin} className="skill-origin-section">
              <div className="skill-group-heading">
                <span className="skill-group-heading-label"><Sparkles size={11} /> {ORIGIN_LABELS[origin]}</span>
                <span className="skill-group-heading-count">{originSkills.length} 项</span>
              </div>
              <div className="skill-origin-section-list">
                {originSkills.map((skill, index) => {
                  const builtinGroupSkill = isBuiltinGroupSkill(skill, groupsById);
                  const groupId = String(skill.group || '');
                  const enabled = isSkillEnabled(skill, groupsById);
                  const originLabel = builtinGroupSkill
                    ? `内置技能组 · ${groupsById.get(groupId).label || groupId}`
                    : ORIGIN_LABELS[origin];
                  const qualifiedName = skill.qualifiedName || skill.name;
                  return (
                    <button
                      type="button"
                      key={`${origin}-${skill.source}-${qualifiedName}-${index}`}
                      className={`skill-card ${enabled ? '' : 'disabled'}`}
                      disabled={!enabled}
                      onClick={() => onInsertSkill?.(qualifiedName)}
                      title={!enabled ? '技能组已关闭或技能不可用' : `插入 $${qualifiedName}`}
                    >
                      <div className="skill-card-title">
                        <span className="skill-card-name font-mono">${qualifiedName}</span>
                        <span className="skill-card-source">{originLabel}</span>
                      </div>
                      <div className="skill-card-description">{skill.description || '暂无技能简介'}</div>
                      <div className="skill-card-capabilities">
                        <span className={`skill-capability-badge explicit ${enabled ? '' : 'disabled'}`}>$ 直接调用</span>
                        {builtinGroupSkill && (
                          <span className={`skill-capability-badge auto ${enabled ? '' : 'disabled'}`}>+ {groupId} 按需</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          {visibleSkills.length === 0 && (
            <div className="loading-placeholder">
              {normalizedQuery || selectedOrigin !== 'all' ? '没有匹配的技能' : '当前没有可用技能'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
