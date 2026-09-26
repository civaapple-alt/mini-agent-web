import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
});
