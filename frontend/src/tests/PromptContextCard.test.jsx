import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PromptContextCard } from '../components/SidePanel';

describe('PromptContextCard', () => {
  it('keeps the raw injected context collapsed behind a readable summary', () => {
    render(
      <PromptContextCard
        context='<world_state><environment os="windows" /></world_state>'
        workspace='D:\\workspace'
        status={{
          mode: 'chat',
          access: 'full',
          policy: 'default',
          direct_file_scope: 'workspace',
          workspace_roots: [{ name: 'workspace' }],
          available_commands: ['git', 'cargo'],
        }}
      />,
    );

    expect(screen.getByText('模型可见的环境与运行约束')).toBeDefined();
    expect(screen.getByText('chat')).toBeDefined();
    expect(screen.queryByText('<world_state><environment os="windows" /></world_state>')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '查看完整注入内容' }));

    const renderedLines = [...document.querySelectorAll('.xml-line-text')].map(
      (line) => line.textContent,
    );
    expect(renderedLines).toContain('<world_state>');
    expect(renderedLines).toContain('  <environment os="windows" />');
    expect(screen.getByRole('button', { name: '收起完整注入内容' })).toBeDefined();
  });
});
