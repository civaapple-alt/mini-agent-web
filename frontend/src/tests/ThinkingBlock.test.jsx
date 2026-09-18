import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import ThinkingBlock from '../components/ThinkingBlock';

describe('ThinkingBlock', () => {
  it('collapses settled reasoning by default', () => {
    render(
      <ThinkingBlock content="已完成的思考" isStreaming={false} />,
    );

    expect(document.querySelector('.thinking-body')).toBeNull();
    expect(document.querySelector('.thinking-preview')?.textContent).toContain('已完成的思考');
  });

  it('follows new reasoning content inside its bounded viewport', () => {
    const { rerender } = render(
      <ThinkingBlock content="第一段思考" isStreaming />,
    );
    const body = document.querySelector('.thinking-body');
    let scrollHeight = 200;
    Object.defineProperty(body, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(body, 'clientHeight', {
      configurable: true,
      value: 100,
    });

    body.scrollTop = 100;
    body.dispatchEvent(new Event('scroll', { bubbles: true }));
    scrollHeight = 420;

    rerender(
      <ThinkingBlock content="第一段思考\n第二段思考\n最新思考" isStreaming />,
    );

    expect(body.scrollTop).toBe(420);
  });

  it('respects a user who scrolls up to inspect earlier reasoning', () => {
    const { rerender } = render(
      <ThinkingBlock content="第一段思考" isStreaming />,
    );
    const body = document.querySelector('.thinking-body');
    let scrollHeight = 300;
    Object.defineProperty(body, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(body, 'clientHeight', {
      configurable: true,
      value: 100,
    });

    body.scrollTop = 20;
    body.dispatchEvent(new Event('scroll', { bubbles: true }));
    scrollHeight = 500;

    rerender(
      <ThinkingBlock content="第一段思考\n更多思考" isStreaming />,
    );

    expect(body.scrollTop).toBe(20);
  });
});
