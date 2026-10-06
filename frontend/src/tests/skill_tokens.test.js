import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterSkills,
  findSkillTrigger,
  isSkillModelInvocable,
  parseSkillPrompt,
  parseWorkflowPrompt,
} from '../utils/skillTokens.js';

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

test('manual-only Skills remain selectable and legacy catalog entries default to model-invocable', () => {
  const manualSkill = {
    name: 'bro',
    qualifiedName: 'pstack:bro',
    enabled: true,
    modelInvocable: false,
  };

  assert.deepEqual(filterSkills([manualSkill], 'bro'), [manualSkill]);
  assert.deepEqual(parseSkillPrompt('$pstack:bro', [manualSkill]), {
    prompt: '',
    selectedSkills: ['pstack:bro'],
    unknownSkills: [],
  });
  assert.equal(isSkillModelInvocable(manualSkill), false);
  assert.equal(isSkillModelInvocable({ name: 'legacy', enabled: true }), true);
});

test('supports pstack qualified names and the plus workflow shorthand', () => {
  const pstackSkills = [
    {
      name: 'how',
      qualifiedName: 'pstack:how',
      aliases: ['pstack-plugin:how', 'how'],
      enabled: true,
    },
  ];
  assert.deepEqual(
    parseSkillPrompt('$pstack:how $pstack-plugin:how $how 解释', pstackSkills),
    {
      prompt: '解释',
      selectedSkills: ['pstack:how'],
      unknownSkills: [],
    },
  );
  assert.deepEqual(
    parseWorkflowPrompt('+ pstack 重构模块', [{ id: 'pstack', enabled: true }]),
    {
      prompt: '重构模块',
      workflow: { kind: 'skill_group', id: 'pstack', mode: 'auto' },
      unknownWorkflows: [],
    },
  );
});

test('supports code-review qualified activation and its opt-in group workflow', () => {
  const codeReviewSkills = [
    'code-review',
    'code-review-breaking-changes',
    'code-review-change-size',
    'code-review-context',
    'code-review-testing',
  ].map((name) => ({
    name,
    qualifiedName: `code-review:${name}`,
    enabled: true,
  }));

  assert.deepEqual(
    parseSkillPrompt(
      '$code-review:code-review $code-review:code-review-testing',
      codeReviewSkills,
    ),
    {
      prompt: '',
      selectedSkills: [
        'code-review:code-review',
        'code-review:code-review-testing',
      ],
      unknownSkills: [],
    },
  );
  assert.deepEqual(
    parseWorkflowPrompt('+ code-review review this change', [
      { id: 'code-review', enabled: true },
    ]),
    {
      prompt: 'review this change',
      workflow: { kind: 'skill_group', id: 'code-review', mode: 'auto' },
      unknownWorkflows: [],
    },
  );
  assert.deepEqual(
    parseWorkflowPrompt('+ code-review review this change', [
      { id: 'code-review', enabled: false },
    ]),
    {
      prompt: '+ code-review review this change',
      workflow: null,
      unknownWorkflows: ['code-review'],
    },
  );
});

test('rejects an ambiguous short Skill name while keeping qualified names', () => {
  const available = [
    {
      name: 'how',
      qualifiedName: 'pstack:how',
      aliases: ['pstack-plugin:how', 'how'],
      enabled: true,
    },
    { name: 'how', qualifiedName: 'how', enabled: true },
  ];
  assert.deepEqual(parseSkillPrompt('$how $pstack:how', available), {
    prompt: '$how',
    selectedSkills: ['pstack:how'],
    unknownSkills: ['how'],
  });
});

test('disabled workflow shorthand stays visible and is rejected by the caller', () => {
  assert.deepEqual(
    parseWorkflowPrompt('+ pstack task', [{ id: 'pstack', enabled: false }]),
    {
      prompt: '+ pstack task',
      workflow: null,
      unknownWorkflows: ['pstack'],
    },
  );
});
