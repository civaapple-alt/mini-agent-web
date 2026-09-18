import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SkillPanel from '../components/SkillPanel';

const skills = [
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
  {
    name: 'product-management',
    qualifiedName: 'knowledge-work:product-management',
    aliases: ['product-management'],
    description: 'Create local product documents and research summaries.',
    source: 'builtin',
    group: 'knowledge-work',
    enabled: true,
  },
];

describe('SkillPanel', () => {
  it('renders every runtime group with generic activation details', () => {
    const onInsertSkill = vi.fn();
    render(
      <SkillPanel
        skills={skills}
        groups={[
          { id: 'pstack', version: '0.2.0', enabled: true },
          { id: 'knowledge-work', version: '0.1.0', enabled: true },
        ]}
        onInsertSkill={onInsertSkill}
      />,
    );

    expect(screen.getByText('两种调用方式')).toBeDefined();
    expect(screen.getByText('pstack · 内置技能组')).toBeDefined();
    expect(screen.getByText('knowledge-work · 内置技能组')).toBeDefined();
    expect(screen.getAllByText('+ pstack · 组内按需')).toHaveLength(1);
    expect(screen.getAllByText('+ knowledge-work · 组内按需')).toHaveLength(1);
    expect(screen.getAllByText('$pstack:how')).toHaveLength(1);
    expect(screen.getByText('$knowledge-work:product-management')).toBeDefined();
    expect(screen.getByText('Design types, interfaces, and module boundaries.')).toBeDefined();
    expect(screen.getAllByText('$ 直接调用')).toHaveLength(3);
    expect(screen.getAllByText('+ pstack 按需')).toHaveLength(2);
    expect(screen.getAllByText('+ knowledge-work 按需')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /\$pstack:architect/ }));
    expect(onInsertSkill).toHaveBeenCalledWith('pstack:architect');
  });

  it('shows a runtime catalog warning when an enabled group has no skill entries', () => {
    render(
      <SkillPanel
        skills={[]}
        groups={[{ id: 'knowledge-work', version: '0.1.0', enabled: true }]}
      />,
    );

    const warning = screen.getByRole('alert');
    expect(warning.textContent).toContain('部分技能组的明细暂不可用');
    expect(warning.textContent).toContain('没有返回对应 Skill catalog');
  });

  it('disables skill cards when their group is disabled', () => {
    render(
      <SkillPanel
        skills={[skills[2]]}
        groups={[{ id: 'knowledge-work', version: '0.1.0', enabled: false }]}
      />,
    );

    expect(screen.getByRole('button', { name: /\$knowledge-work:product-management/ }).disabled).toBe(true);
  });
});
