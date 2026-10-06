import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContextUsageControl } from '../components/InputBar';

describe('ContextUsageControl', () => {
  it('shows unknown provider usage and unknown model window explicitly', () => {
    render(<ContextUsageControl contextUsage={null} />);

    fireEvent.click(screen.getByRole('button', { name: /打开会话上下文详情/ }));

    expect(screen.getByText('用量未知')).toBeDefined();
    expect(screen.getByText(/上下文窗口：未知/)).toBeDefined();
    expect(screen.getByText('本会话累计缓存命中率')).toBeDefined();
    expect(screen.getByText('来源构成估算').closest('details').open).toBe(false);
  });

  it('shows provider-reported cache zero and estimates source categories by bytes', () => {
    render(
      <ContextUsageControl
        contextUsage={{
          usage: { inputTokens: 1000, cachedInputTokens: 0 },
          contextBytes: { projectInstructions: 100, tools: 100 },
          modelContext: {
            providerId: 'test',
            modelId: 'model-2k',
            contextWindowTokens: 2000,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /打开会话上下文详情/ }));

    expect(screen.getByText('0 tokens')).toBeDefined();
    expect(screen.getByRole('button', { name: /1\.0K \/ 2\.0K · 50\.0% · 请求命中 0\.00%/ })).toBeDefined();
    expect(screen.getByText('最近请求缓存命中率')).toBeDefined();
    expect(screen.getByText('0.00%')).toBeDefined();
    expect(screen.getAllByText('≈ 500 tokens')).toHaveLength(2);
    expect(screen.getByText(/占比按输入字节估算/)).toBeDefined();
  });

  it('shows cache usage as unknown when the Provider omits the field', () => {
    render(
      <ContextUsageControl
        contextUsage={{ usage: { inputTokens: 1000, cachedInputTokens: null } }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /打开会话上下文详情/ }));

    expect(screen.getByText(/上下文窗口：未知/)).toBeDefined();
    expect(screen.queryByText('0 tokens')).toBeNull();
    expect(screen.getByText('最近请求缓存命中率')).toBeDefined();
  });

  it('shows the cached token total returned by the Provider without category allocation', () => {
    render(
      <ContextUsageControl
        contextUsage={{
          usage: { inputTokens: 1200, cachedInputTokens: 850 },
          contextBytes: { systemPrompt: 100, conversation: 300 },
          modelContext: {
            providerId: 'test',
            modelId: 'model-10k',
            contextWindowTokens: 10000,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /打开会话上下文详情/ }));

    expect(screen.getByText('850 tokens')).toBeDefined();
    expect(screen.getByText('70.83%')).toBeDefined();
    expect(screen.queryByText(/缓存.*系统提示词/)).toBeNull();
  });

  it('shows the session aggregate on the collapsed control and in details', () => {
    render(
      <ContextUsageControl
        contextUsage={{
          usage: { inputTokens: 1200, cachedInputTokens: 600 },
          modelContext: {
            providerId: 'test',
            modelId: 'model-10k',
            contextWindowTokens: 10000,
          },
        }}
        contextCacheUsage={{
          requestCount: 4,
          cacheReportCount: 3,
          untrackedTurns: 1,
          cacheHitRatio: 0.75,
        }}
      />,
    );

    expect(screen.getByRole('button', { name: /1\.2K \/ 10K · 12\.0% · 请求命中 50\.00%/ })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /打开会话上下文详情/ }));
    expect(screen.getByText('本会话累计缓存命中率')).toBeDefined();
    expect(screen.getByText('75.00%')).toBeDefined();
    expect(screen.getByText(/3 \/ 4 次请求含缓存统计 · 1 个历史回合未累计/)).toBeDefined();
  });

  it('does not substitute the session cache ratio for missing latest usage', () => {
    render(
      <ContextUsageControl
        contextUsage={null}
        contextCacheUsage={{
          requestCount: 3,
          cacheReportCount: 2,
          untrackedTurns: 0,
          cacheHitRatio: 0.6,
        }}
      />,
    );

    expect(screen.getByRole('button', { name: /上下文用量未知/ })).toBeDefined();
  });

  it('closes on outside pointer or Escape while keeping inside clicks open', () => {
    render(<ContextUsageControl contextUsage={null} />);

    fireEvent.click(screen.getByRole('button', { name: /打开会话上下文详情/ }));
    const dialog = screen.getByRole('dialog', { name: '会话上下文用量' });
    fireEvent.pointerDown(dialog);
    expect(screen.getByRole('dialog', { name: '会话上下文用量' })).toBeDefined();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: '会话上下文用量' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /打开会话上下文详情/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '会话上下文用量' })).toBeNull();
  });

  it('resets the open state when the session key changes', () => {
    const renderSession = (threadId) => (
      <ContextUsageControl
        key={threadId}
        contextUsage={null}
      />
    );
    const { rerender } = render(renderSession('thread-a'));

    fireEvent.click(screen.getByRole('button', { name: /打开会话上下文详情/ }));
    expect(screen.getByRole('dialog', { name: '会话上下文用量' })).toBeDefined();

    rerender(renderSession('thread-b'));
    expect(screen.queryByRole('dialog', { name: '会话上下文用量' })).toBeNull();
    expect(screen.getByRole('button', { name: /打开会话上下文详情/ }).getAttribute('aria-expanded'))
      .toBe('false');
  });

  it('uses the request model window for its percentage and keeps output reserve separate', () => {
    render(
      <ContextUsageControl
        contextUsage={{
          usage: { inputTokens: 1800, cachedInputTokens: 0 },
          modelContext: {
            providerId: 'kimi',
            modelId: 'k3-256k',
            contextWindowTokens: 2000,
            maxOutputTokens: 500,
          },
        }}
      />,
    );

    expect(screen.getByRole('button', { name: /1\.8K \/ 2\.0K · 90\.0% · 请求命中 0\.00%/ })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /打开会话上下文详情/ }));
    expect(screen.getByText(/上下文窗口：2,000 tokens/)).toBeDefined();
    expect(screen.queryByText(/超过保存的模型窗口/)).toBeNull();
    expect(screen.getByText(/超过扣除最大输出预留后的预算/)).toBeDefined();
  });

  it('flags provider usage that exceeds the request model context snapshot', () => {
    render(
      <ContextUsageControl
        contextUsage={{
          usage: { inputTokens: 2200, cachedInputTokens: 0 },
          modelContext: {
            providerId: 'kimi',
            modelId: 'k3-256k',
            contextWindowTokens: 2000,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /打开会话上下文详情/ }));
    expect(screen.getByText(/本次输入量高于模型上下文窗口/)).toBeDefined();
  });
});
