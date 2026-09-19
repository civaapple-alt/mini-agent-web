const SKILL_TOKEN_RE = /(^|[\s])(\$[A-Za-z0-9-]+(?::[A-Za-z0-9-]+)?)(?=$|[\s.,!?;:)])/g;
const WORKFLOW_TOKEN_RE = /^\s*\+\s*([A-Za-z0-9-]+)(?=$|\s)/i;

function enabledSkills(availableSkills = []) {
  return availableSkills.filter((skill) => skill?.enabled !== false && skill?.name);
}

function skillReference(skill) {
  return skill?.qualifiedName || skill?.qualified_name || skill?.name;
}

function skillReferences(skill) {
  return [
    skillReference(skill),
    skill.name,
    ...(Array.isArray(skill.aliases) ? skill.aliases : []),
  ].filter(Boolean).map((value) => value.toLowerCase());
}

function skillLookup(availableSkills) {
  const lookup = new Map();
  const ambiguous = new Set();
  for (const skill of enabledSkills(availableSkills)) {
    for (const reference of new Set(skillReferences(skill))) {
      if (ambiguous.has(reference)) continue;
      if (lookup.has(reference)) {
        lookup.delete(reference);
        ambiguous.add(reference);
      } else {
        lookup.set(reference, skill);
      }
    }
  }
  return lookup;
}

export function parseSkillPrompt(text, availableSkills = []) {
  const known = skillLookup(availableSkills);
  const selectedSkills = [];
  const unknownSkills = [];
  let cleaned = '';
  let lastEnd = 0;

  for (const match of text.matchAll(SKILL_TOKEN_RE)) {
    const prefix = match[1] || '';
    const token = match[2];
    const reference = token.slice(1).toLowerCase();
    const tokenStart = match.index + prefix.length;
    const tokenEnd = tokenStart + token.length;
    if (text[tokenStart - 1] === '\\') continue;
    cleaned += text.slice(lastEnd, tokenStart);
    const skill = known.get(reference);
    if (skill) {
      const canonical = skillReference(skill);
      if (!selectedSkills.includes(canonical)) selectedSkills.push(canonical);
    } else {
      unknownSkills.push(reference);
      cleaned += token;
    }
    lastEnd = tokenEnd;
  }
  cleaned += text.slice(lastEnd);
  cleaned = cleaned.replace(/\\(\$[A-Za-z0-9-]+(?::[A-Za-z0-9-]+)?)/g, '$1');
  return {
    prompt: cleaned.replace(/[ \t]{2,}/g, ' ').trim(),
    selectedSkills,
    unknownSkills: [...new Set(unknownSkills)],
  };
}

export function parseWorkflowPrompt(text, skillGroups = []) {
  const groups = new Map(
    (skillGroups || []).map((group) => [String(group?.id || '').toLowerCase(), group]),
  );
  const match = text.match(WORKFLOW_TOKEN_RE);
  if (!match) {
    return { prompt: text.trim(), workflow: null, unknownWorkflows: [] };
  }
  const id = match[1].toLowerCase();
  const group = groups.get(id);
  if (!group || group.enabled === false) {
    return { prompt: text.trim(), workflow: null, unknownWorkflows: [id] };
  }
  return {
    prompt: text.slice(match[0].length).trim(),
    workflow: { kind: 'skill_group', id, mode: 'auto' },
    unknownWorkflows: [],
  };
}

export function findSkillTrigger(text, cursorPosition) {
  const before = text.slice(0, cursorPosition);
  const match = /(^|[\s])\$([A-Za-z0-9-]*(?::[A-Za-z0-9-]*)?)$/.exec(before);
  if (!match) return null;
  const start = match.index + match[1].length;
  if (text[start - 1] === '\\') return null;
  return { start, query: match[2].toLowerCase() };
}

export function filterSkills(availableSkills = [], query = '') {
  const normalizedQuery = query.toLowerCase();
  return enabledSkills(availableSkills).filter((skill) => (
    skillReferences(skill).some((reference) => reference.startsWith(normalizedQuery))
      || skill.description?.toLowerCase().includes(normalizedQuery)
  ));
}

export function skillDisplayName(skill) {
  return skillReference(skill);
}
