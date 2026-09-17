import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import InputBar from '../components/InputBar';

const props = {
  isGenerating: false,
  sessionReadOnly: false,
  onSendMessage: vi.fn(),
  onQueueMessage: vi.fn(),
  onToast: vi.fn(),
  availableSkills: [
    {
      name: 'how',
      qualifiedName: 'pstack:how',
      aliases: ['pstack-plugin:how', 'how'],
      description: 'Explain a subsystem.',
      source: 'builtin',
      group: 'pstack',
      enabled: true,
    },
  ],
  skillGroups: [{ id: 'pstack', version: '0.2.0', enabled: true }],
};

describe('InputBar composer popups', () => {
  it('closes the skill popup when clicking outside it', () => {
    render(<InputBar {...props} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '$' } });
    expect(screen.getByText('加载技能 ($)')).toBeDefined();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByText('加载技能 ($)')).toBeNull();
  });

  it('closes the plugin popup when clicking outside it', () => {
    render(<InputBar {...props} />);

    fireEvent.click(screen.getByTitle('选择当前 Turn 的插件工作流'));
    expect(screen.getByText('插件工作流 (+)')).toBeDefined();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByText('插件工作流 (+)')).toBeNull();
  });
});
