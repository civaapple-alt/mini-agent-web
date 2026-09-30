import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContextUsageControl } from '../components/InputBar';

describe('ContextUsageControl', () => {
  it('shows unknown provider usage and unknown model window explicitly', () => {
    render(<ContextUsageControl contextUsage={null} contextWindow={null} />);

    fireEvent.click(screen.getByRole('button', { name: /打开会话上下文详情/ }));

    expect(screen.getByText('用量未知')).toBeDefined();
    expect(screen.getAllByText('未知')).toHaveLength(4);
    expect(screen.getByText(/模型窗口：大小未知/)).toBeDefined();
    expect(screen.getByText('本会话累计缓存命中率')).toBeDefined();
    expect(screen.getByText(/会话缓存命中率按含缓存数值的 Provider 报告加权汇总/)).toBeDefined();
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

    fireEvent.click(screen.getByRole('button', { name: /打开会话上下文详情/ }));

    expect(screen.getByText('0 tokens')).toBeDefined();
    expect(screen.getByText(/2,000 tokens · 本次输入约 50\.0%/)).toBeDefined();
    expect(screen.getByText('最近请求命中率')).toBeDefined();
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

    fireEvent.click(screen.getByRole('button', { name: /打开会话上下文详情/ }));

    expect(screen.getByText(/窗口 50\.0% · 最近命中 未知/)).toBeDefined();
    expect(screen.getAllByText('未知')).toHaveLength(3);
    expect(screen.queryByText('0 tokens')).toBeNull();
    expect(screen.getByText('最近请求命中率')).toBeDefined();
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

    fireEvent.click(screen.getByRole('button', { name: /打开会话上下文详情/ }));

    expect(screen.getByText('850 tokens')).toBeDefined();
    expect(screen.getByText('70.8%')).toBeDefined();
    expect(screen.queryByText(/缓存.*系统提示词/)).toBeNull();
  });

  it('shows the session aggregate on the collapsed control and in details', () => {
    render(
      <ContextUsageControl
        contextWindow={10000}
        contextUsage={{ usage: { inputTokens: 1200, cachedInputTokens: 600 } }}
        contextCacheUsage={{
          requestCount: 4,
          cacheReportCount: 3,
          untrackedTurns: 1,
          cacheHitRatio: 0.75,
        }}
      />,
    );

    expect(screen.getByRole('button', { name: /会话命中 75\.0%/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /会话命中 75\.0%/ })).toBeDefined();
    expect(screen.getByText(/窗口 12\.0% · 会话命中 75\.0%/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /打开会话上下文详情/ }));
    expect(screen.getByText('本会话累计缓存命中率')).toBeDefined();
    expect(screen.getAllByText('75.0%').length).toBeGreaterThan(0);
    expect(screen.getByText(/3 \/ 4 次用量报告含缓存数值；1 个历史回合没有逐请求累计/)).toBeDefined();
  });

  it('keeps a known session cache ratio visible when the latest usage is missing', () => {
    render(
      <ContextUsageControl
        contextWindow={null}
        contextUsage={null}
        contextCacheUsage={{
          requestCount: 3,
          cacheReportCount: 2,
          untrackedTurns: 0,
          cacheHitRatio: 0.6,
        }}
      />,
    );

    expect(screen.getByRole('button', { name: /窗口未知 · 会话命中 60\.0%/ })).toBeDefined();
  });
});
