import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AssistantActivityGroup from '../components/AssistantActivityGroup';

function tool(name, id, status, output, argumentsValue = {}, extra = {}) {
  return { type: 'tool', name, id, status, output, arguments: argumentsValue, ...extra };
}

describe('web activity summary', () => {
  it('keeps search and page summaries visible while activity details are collapsed', () => {
    const items = [
      tool('web_search', 'search-1', 'completed', JSON.stringify({
        kind: 'web_search',
        resultCount: 2,
        results: [
          { title: 'First result', url: 'https://example.com/first' },
          { title: 'Unsafe result', url: 'javascript:alert(1)' },
        ],
      }), { query: 'example query' }),
      tool('web_fetch', 'fetch-1', 'completed', JSON.stringify({
        kind: 'web_fetch',
        url: 'https://example.com/first',
        title: 'First page',
        handle: 'result-secret-handle',
        nextCursor: '8192',
      }), { url: 'https://example.com/first' }),
      tool('web_fetch', 'fetch-2', 'completed', JSON.stringify({
        kind: 'web_fetch',
        url: 'https://example.com/first',
        title: 'First page',
        continuation: true,
        handle: 'result-secret-handle',
      }), { handle: 'result-secret-handle', cursor: '8192' }),
    ];

    render(
      <AssistantActivityGroup id="web-summary" items={items}>
        <div>Expanded details</div>
      </AssistantActivityGroup>,
    );

    expect(screen.getByText('搜索到 2 个网页')).toBeDefined();
    expect(screen.getByText('浏览 1 个页面')).toBeDefined();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(links.some((link) => link.getAttribute('href')?.startsWith('javascript:'))).toBe(false);
    expect(screen.queryByText('Expanded details')).toBeNull();
    expect(screen.queryByText(/result-secret-handle|8192/)).toBeNull();
  });

  it('shows running, approval, and failed web calls', () => {
    render(
      <AssistantActivityGroup
        id="web-status"
        items={[
          tool('web_search', 'search-run', 'running', null, { query: 'latest release' }),
          tool('web_fetch', 'fetch-wait', 'running', null, { url: 'https://example.com' }, { approval: { state: 'pending' } }),
          tool('web_search', 'search-failed', 'failed', null, { query: 'broken query' }, { error: 'provider error' }),
        ]}
      />,
    );

    expect(screen.getByText('正在搜索「latest release」')).toBeDefined();
    expect(screen.getByText('等待授权')).toBeDefined();
    expect(screen.getByText('搜索失败')).toBeDefined();
  });

  it('reports failed fetches even when the rejected URL cannot be linked', () => {
    render(
      <AssistantActivityGroup
        id="web-fetch-invalid"
        items={[
          tool('web_fetch', 'fetch-invalid', 'failed', null, { url: 'file:///etc/passwd' }, { error: 'unsupported URL' }),
        ]}
      />,
    );

    expect(screen.getByText('浏览失败')).toBeDefined();
  });

  it('can suppress aggregate web summaries when a parent groups nested calls', () => {
    render(
      <AssistantActivityGroup
        id="web-parent"
        showWebActivitySummary={false}
        items={[tool('web_search', 'search-parent', 'completed', JSON.stringify({ resultCount: 0, results: [] }))]}
      />,
    );

    expect(screen.queryByText('搜索到 0 个网页')).toBeNull();
  });
});
