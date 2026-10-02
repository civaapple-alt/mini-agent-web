import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionTurnRail from '../components/SessionTurnRail';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function measureHeight() {
    return this.classList?.contains('session-turn-rail') ? 240 : 24;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function measure() {
    const height = this.classList?.contains('session-turn-rail') ? 240 : 24;
    return {
      x: 0, y: 0, top: 0, left: 0, right: 24, bottom: height,
      width: 24, height, toJSON: () => ({}),
    };
  });
});

afterEach(() => vi.restoreAllMocks());

describe('SessionTurnRail', () => {
  it('renders turn details in a hover tooltip outside the scrollable rail', () => {
    const entry = {
      turnId: 'turn-1',
      summary: 'Inspect the workspace',
      responseSummary: 'The workspace scan is complete.',
      metrics: { steps: 4, toolCount: 2 },
    };
    render(<SessionTurnRail entries={[entry]} />);

    const node = screen.getByRole('button', { name: /Inspect the workspace/ });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(node);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.parentElement).toBe(document.body);
    expect(tooltip.textContent).toContain('Inspect the workspace');
    expect(tooltip.textContent).toContain('The workspace scan is complete.');
    expect(tooltip.textContent).toContain('已执行 4 步');
    expect(node.getAttribute('aria-describedby')).toBe(tooltip.id);

    fireEvent.mouseLeave(node);
    fireEvent.mouseEnter(tooltip);
    expect(screen.getByRole('tooltip')).toBe(tooltip);
  });
});
