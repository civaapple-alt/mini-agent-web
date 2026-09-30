import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MarkdownRenderer from '../components/MarkdownRenderer';

describe('MarkdownRenderer', () => {
  it('opens session links in a new tab with opener isolation', () => {
    render(
      <MarkdownRenderer>
        {'查看 [驱动中国](https://example.com/news "新闻来源")'}
      </MarkdownRenderer>,
    );

    const link = screen.getByRole('link', { name: '驱动中国' });
    expect(link.getAttribute('href')).toBe('https://example.com/news');
    expect(link.getAttribute('title')).toBe('新闻来源');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
