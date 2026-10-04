import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import MessageItem from '../components/MessageItem';

describe('MessageItem resend action', () => {
  it('preserves every original input field when resending a user prompt', () => {
    const onRetryPrompt = vi.fn();
    const message = {
      id: 'user-1',
      role: 'user',
      text: '请检查这份材料',
      images: ['data:image/png;base64,example'],
      referencedFiles: ['docs/brief.md'],
      textAttachments: [{ name: 'notes.txt', content: '原始备注' }],
      fileAttachments: [{ name: 'source.pdf', path: '/workspace/source.pdf' }],
      selectedSkills: ['research'],
      workflow: { id: 'writing', name: 'Writing' },
    };

    render(
      <MessageItem
        message={message}
        isLast={false}
        isGenerating={false}
        onRetryPrompt={onRetryPrompt}
      />,
    );

    fireEvent.click(screen.getByTitle('重新发送此提示词'));

    expect(onRetryPrompt).toHaveBeenCalledWith({
      prompt: message.text,
      images: message.images,
      referencedFiles: message.referencedFiles,
      textAttachments: message.textAttachments,
      fileAttachments: message.fileAttachments,
      selectedSkills: message.selectedSkills,
      workflow: message.workflow,
    });
  });

  it('renders Host injection metadata separately from an ordinary file read tool', () => {
    render(
      <MessageItem
        message={{
          id: 'assistant-context',
          role: 'assistant',
          text: '',
          blocks: [
            {
              type: 'context_injected',
              id: 'context-turn-1',
              records: [{
                id: 'agents-main',
                kind: 'project_instructions',
                source: 'AGENTS.md',
                workspace: 'main',
                path: 'AGENTS.md',
                scope: 'workspace',
                bytes: 64,
                fingerprint: 'abc123',
                body: 'must not appear in the metadata card',
              }],
            },
            {
              type: 'tool',
              id: 'read-1',
              name: 'read_file',
              status: 'completed',
              output: 'ordinary read_file result',
            },
          ],
        }}
        isLast
        isGenerating={false}
      />,
    );

    expect(screen.getByText('Host 注入')).toBeDefined();
    const injectionCard = document.querySelector('.context-injection-card');
    expect(injectionCard).toBeTruthy();
    expect(within(injectionCard).getAllByText('AGENTS.md')).toHaveLength(2);
    expect(document.querySelector('.tool-card')).toBeTruthy();
    expect(screen.queryByText('must not appear in the metadata card')).toBeNull();
  });
});
