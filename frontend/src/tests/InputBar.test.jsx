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
  it('keeps short clipboard text in the composer', () => {
    render(<InputBar {...props} />);
    const textbox = screen.getByRole('textbox');
    const preventDefault = vi.fn();

    fireEvent.paste(textbox, {
      preventDefault,
      clipboardData: {
        items: [],
        getData: () => '请检查这个函数',
      },
    });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(screen.queryByText('pasted-text.txt')).toBeNull();
  });

  it('stores a long diagnostic paste as a temporary text attachment', () => {
    const onSendMessage = vi.fn();
    render(<InputBar {...props} onSendMessage={onSendMessage} />);
    const diagnostic = [
      'INFO: Shutting down',
      'INFO: Waiting for connections to close.',
      'ERROR: Exception in ASGI application',
      'Traceback (most recent call last):',
      '  File "server.py", line 42, in run',
      '    await app(scope, receive, send)',
    ].join('\n');
    const textbox = screen.getByRole('textbox');

    fireEvent.paste(textbox, {
      clipboardData: {
        items: [],
        getData: () => diagnostic,
      },
    });

    expect(textbox.value).toBe('');
    expect(screen.getByText('pasted-text.txt')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(onSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '',
      textAttachments: [expect.objectContaining({
        name: 'pasted-text.txt',
        content: diagnostic,
      })],
    }));
  });

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
