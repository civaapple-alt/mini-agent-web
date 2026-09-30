import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContextUsageControl } from '../components/InputBar';

describe('ContextUsageControl', () => {
  it('shows unknown provider usage and unknown model window explicitly', () => {
    render(<ContextUsageControl contextUsage={null} contextWindow={null} />);

    fireEvent.click(screen.getByRole('button', { name: '查看最近一次模型请求的上下文用量和缓存命中率' }));

    expect(screen.getByText('用量未知')).toBeDefined();
    expect(screen.getAllByText('未知')).toHaveLength(3);
    expect(screen.getByText(/模型窗口：大小未知/)).toBeDefined();
    expect(screen.getByText('整体缓存命中率')).toBeDefined();
    expect(screen.getByText(/缓存命中率按 Provider 报告的缓存输入/)).toBeDefined();
  });

  it('shows provider-reported cache zero and estimates source categories by bytes', () => {
    render(
      <ContextUsageControl
        contextWindow={2000}
        contextUsage={{
          usage: { inputTokens: 1000, cachedInputTokens: 0 },
          contextBytes: { projectInstructions: 100, tools: 100 },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '查看最近一次模型请求的上下文用量和缓存命中率' }));

    expect(screen.getByText('0 tokens')).toBeDefined();
    expect(screen.getByText(/2,000 tokens · 本次输入约 50\.0%/)).toBeDefined();
    expect(screen.getByText('整体缓存命中率')).toBeDefined();
    expect(screen.getByText('0.0%')).toBeDefined();
    expect(screen.getAllByText('≈ 500 tokens')).toHaveLength(2);
    expect(screen.getByText(/来源占比按输入字节估算/)).toBeDefined();
  });

  it('shows cache usage as unknown when the Provider omits the field', () => {
    render(
      <ContextUsageControl
        contextWindow={2000}
        contextUsage={{ usage: { inputTokens: 1000, cachedInputTokens: null } }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '查看最近一次模型请求的上下文用量和缓存命中率' }));

    expect(screen.getByText(/窗口 50\.0% · 缓存命中 未知/)).toBeDefined();
    expect(screen.getAllByText('未知')).toHaveLength(2);
    expect(screen.queryByText('0 tokens')).toBeNull();
    expect(screen.getByText(/缓存命中 未知/)).toBeDefined();
  });

  it('shows the cached token total returned by the Provider without category allocation', () => {
    render(
      <ContextUsageControl
        contextWindow={10000}
        contextUsage={{
          usage: { inputTokens: 1200, cachedInputTokens: 850 },
          contextBytes: { systemPrompt: 100, conversation: 300 },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '查看最近一次模型请求的上下文用量和缓存命中率' }));

    expect(screen.getByText('850 tokens')).toBeDefined();
    expect(screen.getByText('70.8%')).toBeDefined();
    expect(screen.queryByText(/缓存.*系统提示词/)).toBeNull();
  });
});
