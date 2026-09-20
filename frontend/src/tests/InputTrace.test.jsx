import { describe, expect, it } from 'vitest';
import {
  collectInputMessages,
  cleanInputText,
  createInputTrace,
  extractFileAttachmentNames,
  getInputTrace,
  extractTextAttachmentNames,
  isInternalCompactionMessage,
} from '../utils/inputTrace';

describe('input trace presentation', () => {
  it('captures bounded live scope and execution settings', () => {
    const trace = createInputTrace({
      threadId: 't-1',
      projectId: 'project-a',
      turnId: 'turn-1',
      accessScope: 'project',
      policy: 'trusted',
      continuationMode: 'continuous',
      planActive: true,
      goalActive: false,
      images: ['data:image/png;base64,a'],
      referencedFiles: ['src/App.jsx'],
    });

    expect(trace.scope).toEqual({
      projectId: 'project-a',
      threadId: 't-1',
      turnId: 'turn-1',
    });
    expect(trace.execution).toMatchObject({
      accessScope: 'project',
      policy: 'trusted',
      continuationMode: 'continuous',
      planActive: true,
    });
    expect(trace.attachments).toMatchObject({ imageCount: 1, known: true });
    expect(trace.attachments.referencedFiles).toEqual(['src/App.jsx']);
  });

  it('does not invent execution settings for a historical message', () => {
    const trace = getInputTrace(
      { role: 'user', id: 'history-1', text: '历史问题' },
      { threadId: 't-history', projectId: 'project-a' },
    );

    expect(trace.historical).toBe(true);
    expect(trace.execution).toBeNull();
    expect(trace.scope).toMatchObject({
      projectId: 'project-a',
      threadId: 't-history',
    });
    expect(trace.attachments.known).toBe(false);
  });

  it('merges durable user items missing from a compacted checkpoint', () => {
    const messages = collectInputMessages(
      [{ role: 'user', id: 'current', text: '当前输入', turnId: 'turn-2' }],
      [
        {
          turnId: 'turn-1',
          capturedAt: '2026-09-17T10:00:00.000Z',
          item: { type: 'userMessage', id: 'old', text: '较早输入' },
        },
        {
          turnId: 'turn-2',
          capturedAt: '2026-09-17T10:01:00.000Z',
          item: { type: 'userMessage', id: 'current-item', text: '当前输入' },
        },
      ],
      { threadId: 't-history', projectId: 'project-a' },
    );

    expect(messages.map((message) => message.text)).toEqual(['较早输入', '当前输入']);
    expect(getInputTrace(messages[0]).capturedAt).toBe('2026-09-17T10:00:00.000Z');
  });

  it('keeps a later steer separate when it shares a turn with the first input', () => {
    const messages = collectInputMessages(
      [{ role: 'user', id: 'checkpoint-input', text: 'initial prompt', turnId: 'turn-1' }],
      [
        {
          turnId: 'turn-1',
          item: { type: 'userMessage', id: 'input-1', text: 'initial prompt', inputSource: 'user' },
        },
        {
          turnId: 'turn-1',
          item: { type: 'userMessage', id: 'input-2', text: 'second steer', inputSource: 'steer' },
        },
      ],
      { threadId: 't-history', projectId: 'project-a' },
    );

    expect(messages.map((message) => message.text)).toEqual(['initial prompt', 'second steer']);
    expect(messages[1]).toMatchObject({
      id: 'input-2',
      inputSource: 'steer',
      isSteer: true,
      messageKind: 'steer',
      steerTurnId: 'turn-1',
    });
    expect(getInputTrace(messages[1]).source).toBe('steer');
  });

  it('keeps the synthetic compaction summary out of input history', () => {
    const summary = {
      role: 'user',
      id: 'compaction-1',
      text: '[Compacted conversation context]\n# Handoff Summary\nContinue the work.',
    };

    expect(isInternalCompactionMessage(summary)).toBe(true);
    expect(isInternalCompactionMessage({ role: 'user', text: '真实用户输入' })).toBe(false);
    expect(collectInputMessages(
      [
        summary,
        { role: 'user', id: 'user-1', text: '真实用户输入', turnId: 'turn-1' },
      ],
      [
        { turnId: 'turn-0', item: { type: 'userMessage', id: 'compaction-item', ...summary } },
        { turnId: 'turn-1', item: { type: 'userMessage', id: 'user-item', text: '真实用户输入' } },
      ],
    )).toEqual([
      { role: 'user', id: 'user-1', text: '真实用户输入', turnId: 'turn-1' },
    ]);
  });

  it('keeps a safe image count when history only has gateway context', () => {
    const message = {
      role: 'user',
      text: '分析这张图\n\n[User Attached Image: C:\\private\\clipboard.png (Gateway session attachment)]',
    };
    const trace = getInputTrace(message);

    expect(trace.attachments).toMatchObject({ imageCount: 1, known: true });
    expect(cleanInputText(message.text)).toBe('分析这张图');
  });

  it('keeps pasted text out of the displayed prompt and exposes its name', () => {
    const message = {
      role: 'user',
      text: '分析这个错误\n\n[User Attached Text: C:\\private\\pasted_123.txt (name: pasted-text.txt; Gateway session attachment)]',
    };

    expect(cleanInputText(message.text)).toBe('分析这个错误');
    expect(extractTextAttachmentNames(message.text)).toEqual(['pasted-text.txt']);
    expect(getInputTrace(message).attachments).toMatchObject({ textCount: 1, known: true });
  });

  it('keeps file and path attachment paths out of history text', () => {
    const message = {
      role: 'user',
      text: '检查附件\n\n[User Attached Path: C:\\private\\how (name: how; folder; read-only path reference)]',
    };

    expect(cleanInputText(message.text)).toBe('检查附件');
    expect(extractFileAttachmentNames(message.text)).toEqual(['how']);
    expect(getInputTrace(message).attachments).toMatchObject({ fileCount: 1, known: true });
  });

});
