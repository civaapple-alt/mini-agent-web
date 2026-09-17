import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SkillPanel from '../components/SkillPanel';

const pstackSkills = [
  {
    name: 'architect',
    qualifiedName: 'pstack:architect',
    aliases: ['pstack-plugin:architect', 'architect'],
    description: 'Design types, interfaces, and module boundaries.',
    source: 'builtin',
    group: 'pstack',
    enabled: true,
  },
  {
    name: 'how',
    qualifiedName: 'pstack:how',
    aliases: ['pstack-plugin:how', 'how'],
    description: 'Explain how a subsystem works.',
    source: 'builtin',
    group: 'pstack',
    enabled: true,
  },
];

describe('SkillPanel', () => {
  it('explains group and skill activation and lists pstack skill details', () => {
    const onInsertSkill = vi.fn();
    render(
      <SkillPanel
        skills={pstackSkills}
        groups={[{ id: 'pstack', version: '0.2.0', enabled: true }]}
        onInsertSkill={onInsertSkill}
      />,
    );

    expect(screen.getByText('两种调用方式')).toBeDefined();
    expect(screen.getAllByText('+ pstack')).toHaveLength(2);
    expect(screen.getAllByText('$pstack:how')).toHaveLength(2);
    expect(screen.getByText('pstack · 内置技能组')).toBeDefined();
    expect(screen.getByText('Design types, interfaces, and module boundaries.')).toBeDefined();
    expect(screen.getAllByText('$ 直接调用')).toHaveLength(2);
    expect(screen.getAllByText('+ pstack 按需')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /\$pstack:architect/ }));
    expect(onInsertSkill).toHaveBeenCalledWith('pstack:architect');
  });

  it('shows a runtime catalog warning when pstack has no skill entries', () => {
    render(
      <SkillPanel
        skills={[]}
        groups={[{ id: 'pstack', version: '0.2.0', enabled: true }]}
      />,
    );

    const warning = screen.getByRole('alert');
    expect(warning.textContent).toContain('pstack 组内技能明细暂不可用');
    expect(warning.textContent).toContain('没有返回 Skill catalog');
  });
});
