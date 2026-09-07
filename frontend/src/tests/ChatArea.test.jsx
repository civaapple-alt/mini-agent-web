import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatArea from '../components/ChatArea';

describe('ChatArea turn status', () => {
  it('shows the settled failure reason instead of a generic incomplete label', () => {
    render(
      <ChatArea
        messages={[]}
        isGenerating={false}
        pendingApproval={null}
        lastTurnResult={{
          status: 'failed',
          steps: 2,
          error: 'model request failed: transport error',
        }}
        onQuickPrompt={() => {}}
        onRetryPrompt={() => {}}
      />,
    );

    expect(screen.getByText('本轮执行失败')).toBeDefined();
    expect(screen.getByText(/原因：model request failed: transport error/)).toBeDefined();
    expect(screen.queryByText('本轮未完整结束')).toBeNull();
  });
});
