import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('keeps a selected Skill in the chip and removes its token from the input', () => {
    const onSendMessage = vi.fn();
    render(<InputBar {...props} onSendMessage={onSendMessage} />);
    const textbox = screen.getByRole('textbox');

    fireEvent.change(textbox, { target: { value: '解释 $', selectionStart: 4, selectionEnd: 4 } });
    fireEvent.click(screen.getByText('$pstack:how'));

    expect(textbox.value).toBe('解释');
    expect(screen.getByLabelText('移除技能 pstack:how')).toBeDefined();
    expect(screen.queryByText('$pstack:how', { selector: 'textarea' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(onSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '解释',
      selectedSkills: ['pstack:how'],
    }));
  });

  it('closes the plugin popup when clicking outside it', () => {
    render(<InputBar {...props} />);

    fireEvent.click(screen.getByTitle('添加文件、目标、计划或当前 Turn 的插件工作流'));
    expect(screen.getByText('添加 (+)')).toBeDefined();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByText('添加 (+)')).toBeNull();
  });

  it('shows a Target chip without activating Goal before submit', () => {
    const onStartGoal = vi.fn();
    render(<InputBar {...props} onStartGoal={onStartGoal} />);

    fireEvent.click(screen.getByTitle('添加文件、目标、计划或当前 Turn 的插件工作流'));
    fireEvent.click(screen.getByRole('button', { name: /目标 提交后设置 Goal/ }));

    expect(screen.getByText('目标')).toBeDefined();
    expect(onStartGoal).not.toHaveBeenCalled();
  });

  it('submits a selected file through the unified plus menu', async () => {
    const onSendMessage = vi.fn();
    render(<InputBar {...props} onSendMessage={onSendMessage} />);
    const input = document.querySelector('input[type="file"]');
    const file = new File(['hello'], 'notes.md', { type: 'text/markdown' });

    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('notes.md')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(onSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      fileAttachments: [expect.objectContaining({ name: 'notes.md' })],
    }));
  });

  it('records a dropped folder as a physical path reference', () => {
    const onSendMessage = vi.fn();
    const previousBridge = globalThis.__MINI_AGENT_FILE_BRIDGE__;
    globalThis.__MINI_AGENT_FILE_BRIDGE__ = {
      pathsFromDataTransfer: () => ['C:\\workspace\\how'],
    };
    try {
      render(<InputBar {...props} onSendMessage={onSendMessage} />);
      const form = screen.getByRole('textbox').closest('form');
      fireEvent.drop(form, { dataTransfer: { types: ['Files'] } });
      expect(screen.getByText('how')).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: '发送' }));
      expect(onSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        fileAttachments: [expect.objectContaining({
          name: 'how',
          path: 'C:\\workspace\\how',
          source: 'path',
        })],
      }));
    } finally {
      if (previousBridge === undefined) delete globalThis.__MINI_AGENT_FILE_BRIDGE__;
      else globalThis.__MINI_AGENT_FILE_BRIDGE__ = previousBridge;
    }
  });
});
