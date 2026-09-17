import assert from 'node:assert/strict';
import test from 'node:test';
import { filterSkills, findSkillTrigger, parseSkillPrompt } from '../utils/skillTokens.js';

const skills = [
  { name: 'architect', enabled: true },
  { name: 'why', enabled: true },
  { name: 'disabled-skill', enabled: false },
];

test('extracts, deduplicates, and removes explicit skill tokens', () => {
  assert.deepEqual(
    parseSkillPrompt('重构 $architect 这个模块并参考 $architect $why', skills),
    {
      prompt: '重构 这个模块并参考',
      selectedSkills: ['architect', 'why'],
      unknownSkills: [],
    },
  );
});

test('keeps escaped and unknown skill tokens visible', () => {
  assert.deepEqual(
    parseSkillPrompt('文本 \\$architect 和 $missing', skills),
    {
      prompt: '文本 $architect 和 $missing',
      selectedSkills: [],
      unknownSkills: ['missing'],
    },
  );
});

test('requires a trailing token boundary before extracting a skill', () => {
  assert.deepEqual(parseSkillPrompt('$architective $architect,', skills), {
    prompt: '$architective ,',
    selectedSkills: ['architect'],
    unknownSkills: ['architective'],
  });
});

test('skill completion only exposes enabled prefix matches', () => {
  assert.deepEqual(filterSkills(skills, 'arc').map((skill) => skill.name), ['architect']);
  assert.deepEqual(findSkillTrigger('重构 $arc', 9), { start: 3, query: 'arc' });
  assert.equal(findSkillTrigger('文本 \\$arc', 9), null);
});
