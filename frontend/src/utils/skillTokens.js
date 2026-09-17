const SKILL_TOKEN_RE = /(^|[\s])(\$[A-Za-z0-9-]+)(?=$|[\s.,!?;:)])/g;

function enabledSkills(availableSkills = []) {
  return availableSkills.filter((skill) => skill?.enabled !== false && skill?.name);
}

export function parseSkillPrompt(text, availableSkills = []) {
  const known = new Set(enabledSkills(availableSkills).map((skill) => skill.name));
  const selectedSkills = [];
  const unknownSkills = [];
  let cleaned = '';
  let lastEnd = 0;

  for (const match of text.matchAll(SKILL_TOKEN_RE)) {
    const prefix = match[1] || '';
    const token = match[2];
    const name = token.slice(1).toLowerCase();
    const tokenStart = match.index + prefix.length;
    const tokenEnd = tokenStart + token.length;
    if (text[tokenStart - 1] === '\\') continue;
    cleaned += text.slice(lastEnd, tokenStart);
    if (known.has(name)) {
      if (!selectedSkills.includes(name)) selectedSkills.push(name);
    } else {
      unknownSkills.push(name);
      cleaned += token;
    }
    lastEnd = tokenEnd;
  }
  cleaned += text.slice(lastEnd);
  cleaned = cleaned.replace(/\\(\$[A-Za-z0-9-]+)/g, '$1');
  return {
    prompt: cleaned.replace(/[ \t]{2,}/g, ' ').trim(),
    selectedSkills,
    unknownSkills: [...new Set(unknownSkills)],
  };
}

export function findSkillTrigger(text, cursorPosition) {
  const before = text.slice(0, cursorPosition);
  const match = /(^|[\s])\$([A-Za-z0-9-]*)$/.exec(before);
  if (!match) return null;
  const start = match.index + match[1].length;
  if (text[start - 1] === '\\') return null;
  return { start, query: match[2].toLowerCase() };
}

export function filterSkills(availableSkills = [], query = '') {
  return enabledSkills(availableSkills).filter((skill) => (
    skill.name.toLowerCase().startsWith(query.toLowerCase())
  ));
}
