import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SkillPanel from '../components/SkillPanel';

const builtinSkills = [
  {
    name: 'architect',
    qualifiedName: 'pstack:architect',
    aliases: ['pstack-plugin:architect', 'architect'],
    description: 'Design types, interfaces, and module boundaries.',
    source: 'builtin',
    origin: 'builtin_group',
    group: 'pstack',
    enabled: true,
  },
  {
    name: 'how',
    qualifiedName: 'pstack:how',
    aliases: ['pstack-plugin:how', 'how'],
    description: 'Explain how a subsystem works.',
    source: 'builtin',
    origin: 'builtin_group',
    group: 'pstack',
    enabled: true,
  },
  {
    name: 'product-management',
    qualifiedName: 'knowledge-work:product-management',
    aliases: ['product-management'],
    description: 'Create local product documents and research summaries.',
    source: 'builtin',
    origin: 'builtin_group',
    group: 'knowledge-work',
    enabled: true,
  },
];

const sourceSkills = [
  {
    name: 'frontend-design',
    qualifiedName: 'frontend-design',
    aliases: ['ui-design'],
    description: 'Design user interfaces.',
    source: 'user',
    origin: 'user_agents',
    enabled: true,
  },
  {
    name: 'local-helper',
    qualifiedName: 'local-helper',
    aliases: ['helper-alias'],
    description: 'A personal Mini Agent Skill.',
    source: 'user',
    origin: 'user_mini_agent',
    enabled: true,
  },
  {
    name: 'blender-modeling',
    qualifiedName: 'blender-modeling',
    aliases: [],
    description: 'Model Blender scenes.',
    source: 'project',
    origin: 'project',
    enabled: true,
  },
  {
    name: 'deploy',
    qualifiedName: 'deploy',
    aliases: [],
    description: 'Deploy an application.',
    source: 'plugin',
    origin: 'plugin',
    enabled: true,
  },
];

describe('SkillPanel', () => {
  it('shows source groups and inserts the canonical name when a skill is selected', () => {
    const onInsertSkill = vi.fn();
    render(
      <SkillPanel
        skills={builtinSkills}
        groups={[
          { id: 'pstack', version: '0.2.0', enabled: true },
          { id: 'knowledge-work', version: '0.1.0', enabled: true },
        ]}
        onInsertSkill={onInsertSkill}
      />,
    );

    expect(screen.getByRole('button', { name: '全部 3' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('内置技能组')).toBeDefined();
    expect(screen.getAllByText('内置技能组 · pstack')).toHaveLength(2);
    expect(screen.getByText('内置技能组 · knowledge-work')).toBeDefined();
    expect(screen.queryByText('两种调用方式')).toBeNull();
    expect(screen.queryByText('pstack-plugin:architect')).toBeNull();
    expect(screen.getAllByText('+ pstack 按需')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '内置 3' }));
    expect(screen.getAllByText('+ pstack 按需')).toHaveLength(2);
    expect(screen.getAllByText('+ knowledge-work 按需')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /\$pstack:architect/ }));
    expect(onInsertSkill).toHaveBeenCalledWith('pstack:architect');
  });

  it('filters by origin, displays catalog counts, and searches aliases across sources', () => {
    render(<SkillPanel skills={[...builtinSkills, ...sourceSkills]} groups={[{ id: 'pstack', enabled: true }]} />);

    expect(screen.getByRole('button', { name: '全部 7' })).toBeDefined();
    expect(screen.getByRole('button', { name: '~/.agents 1' })).toBeDefined();
    expect(screen.getByRole('button', { name: '~/.mini-agent 1' })).toBeDefined();
    expect(screen.getByRole('button', { name: '项目 1' })).toBeDefined();
    expect(screen.getByRole('button', { name: '插件 1' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '项目 1' }));
    expect(screen.getByRole('button', { name: /\$blender-modeling/ })).toBeDefined();
    expect(screen.queryByRole('button', { name: /\$frontend-design/ })).toBeNull();
    expect(screen.getByRole('button', { name: '项目 1' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '全部 7' }));
    fireEvent.change(screen.getByRole('textbox', { name: '搜索技能' }), { target: { value: 'helper-alias' } });
    expect(screen.getByRole('button', { name: /\$local-helper/ })).toBeDefined();
    expect(screen.queryByRole('button', { name: /\$frontend-design/ })).toBeNull();
  });

  it('uses the legacy personal-directory label without guessing its exact root', () => {
    render(
      <SkillPanel
        skills={[{
          name: 'old-skill',
          qualifiedName: 'old-skill',
          description: 'From an older runtime.',
          source: 'user',
          enabled: true,
        }]}
      />,
    );

    expect(screen.getAllByText('个人目录技能 · 来源未细分')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /个人来源未细分 1/ })).toBeDefined();
  });

  it('does not treat user or project labels as groups, even when they have a group-like value', () => {
    const onInsertSkill = vi.fn();
    render(
      <SkillPanel
        skills={[
          { name: 'user-skill', qualifiedName: 'user-skill', description: 'User Skill.', source: 'user', group: 'user', enabled: true },
          { name: 'project-skill', qualifiedName: 'project-skill', description: 'Project Skill.', source: 'project', group: 'project', enabled: true },
          { name: 'disabled-skill', qualifiedName: 'disabled-skill', description: 'Disabled Skill.', source: 'user', enabled: false },
        ]}
        groups={[{ id: 'pstack', version: '0.2.0', enabled: true }]}
        onInsertSkill={onInsertSkill}
      />,
    );

    expect(screen.queryByText('+ user 按需')).toBeNull();
    expect(screen.queryByText('+ project 按需')).toBeNull();
    expect(screen.getByRole('button', { name: /\$user-skill/ }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /\$project-skill/ }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /\$disabled-skill/ }).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /\$user-skill/ }));
    fireEvent.click(screen.getByRole('button', { name: /\$project-skill/ }));
    expect(onInsertSkill).toHaveBeenNthCalledWith(1, 'user-skill');
    expect(onInsertSkill).toHaveBeenNthCalledWith(2, 'project-skill');
  });

  it('keeps an empty builtin group filter available for group management and warning states', () => {
    const onToggleGroup = vi.fn();
    render(
      <SkillPanel
        skills={[]}
        groups={[
          { id: 'knowledge-work', version: '0.1.0', enabled: true },
          { id: 'code-review', version: '0.1.0', enabled: false },
        ]}
        onToggleGroup={onToggleGroup}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '内置 0' }));
    expect(screen.getByRole('alert').textContent).toContain('部分技能组的明细暂不可用');
    const settings = document.querySelector('.skill-group-settings');
    expect(settings).not.toBeNull();
    expect(settings.open).toBe(false);
    fireEvent.click(within(settings).getByText('2 组 · 展开管理启用状态'));
    fireEvent.click(screen.getByRole('button', { name: '启用技能组 code-review' }));
    expect(onToggleGroup).toHaveBeenCalledWith('code-review', true);
  });

  it('disables builtin skills when their associated group is disabled', () => {
    render(
      <SkillPanel
        skills={[builtinSkills[2]]}
        groups={[{ id: 'knowledge-work', version: '0.1.0', enabled: false }]}
      />,
    );

    expect(screen.getByRole('button', { name: /\$knowledge-work:product-management/ }).disabled).toBe(true);
  });

  it('shows an empty result for a source or query with no matching skills', () => {
    render(<SkillPanel skills={sourceSkills} />);

    fireEvent.click(screen.getByRole('button', { name: '插件 1' }));
    fireEvent.change(screen.getByRole('textbox', { name: '搜索技能' }), { target: { value: 'not-found' } });
    expect(screen.getByText('没有匹配的技能')).toBeDefined();
  });
});
