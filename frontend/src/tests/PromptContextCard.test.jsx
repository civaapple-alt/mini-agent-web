import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PromptContextCard } from '../components/SidePanel';

describe('PromptContextCard', () => {
  it('shows source metadata and byte composition without exposing source bodies', () => {
    render(
      <PromptContextCard
        injections={[{
          id: 'workspace_agents_main',
          kind: 'project_instructions',
          source: 'AGENTS.md',
          workspace: 'main',
          path: 'AGENTS.md',
          scope: 'workspace',
          bytes: 128,
          fingerprint: 'abc123',
        }]}
        contextUsage={{
          usage: { inputTokens: 1000, cachedInputTokens: 0 },
          contextBytes: { projectInstructions: 128, tools: 64 },
        }}
        workspace='D:\\workspace'
        status={{
          mode: 'chat',
          access: 'full',
          policy: 'default',
          direct_file_scope: 'workspace',
          workspace_roots: [{ name: 'workspace' }],
          session_read_roots: [{ name: 'attachments', path: 'C:\\state\\attachments' }],
          available_commands: ['git', 'cargo'],
        }}
      />,
    );

    expect(screen.getByText('注入来源与最近请求的上下文占比')).toBeDefined();
    expect(screen.getByText('chat')).toBeDefined();
    expect(screen.getByText('1 个会话附件根')).toBeDefined();
    expect(screen.getByText('AGENTS.md')).toBeDefined();
    expect(screen.getByText('128 B')).toBeDefined();
    expect(screen.getByText('项目指令')).toBeDefined();
    expect(screen.getByText('整体缓存命中率')).toBeDefined();
    expect(screen.getByText('0.0%')).toBeDefined();
    expect(screen.getByText('66.7%')).toBeDefined();
    expect(screen.getByText('33.3%')).toBeDefined();
    expect(screen.queryByText(/environment os/)).toBeNull();
    expect(screen.queryByRole('button', { name: /完整注入内容|复制原文/ })).toBeNull();
  });

  it('labels old history without injection metadata as unknown', () => {
    render(<PromptContextCard />);

    expect(screen.getByText(/来源未知/)).toBeDefined();
    expect(screen.getByText('字节构成未知')).toBeDefined();
  });
});
