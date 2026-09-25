import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AssistantActivityGroup from '../components/AssistantActivityGroup';

describe('AssistantActivityGroup failures', () => {
  it('shows failure counts and tool types in the collapsed activity summary', () => {
    render(
      <AssistantActivityGroup
        id="collapsed-failure-summary"
        presentationId="collapsed-failure-summary"
        failureCount={2}
        failureTypes={[{ name: 'apply_patch', count: 2 }]}
        items={[
          { type: 'thinking', id: 'thinking-1' },
          { type: 'tool', id: 'tool-1', status: 'failed', error: 'first hunk did not match' },
          { type: 'tool', id: 'tool-2', status: 'failed', error: 'second hunk did not match' },
        ]}
      >
        <div>失败详情 remains available when expanded</div>
      </AssistantActivityGroup>,
    );

    const summary = screen.getByRole('button', { name: /失败 2 次 · apply_patch ×2/ });
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('失败详情 remains available when expanded')).toBeNull();

    fireEvent.click(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('失败详情 remains available when expanded')).toBeTruthy();
  });
});
