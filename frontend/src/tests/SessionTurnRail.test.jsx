import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SessionTurnRail from '../components/SessionTurnRail';

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
