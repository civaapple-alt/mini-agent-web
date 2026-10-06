import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppLayout from '../components/AppLayout';

const { childTasksMock } = vi.hoisted(() => ({ childTasksMock: vi.fn() }));

vi.mock('../components/Header', () => ({ default: () => null }));
vi.mock('../components/Sidebar', () => ({ default: () => null }));
vi.mock('../components/ChatArea', () => ({ default: () => null }));
vi.mock('../components/InputBar', () => ({
  default: ({ approvalDockPendingApproval, approvalDockCount, onRespondApproval }) => (
    approvalDockPendingApproval ? (
      <div data-testid="approval-dock">
        <span>{approvalDockPendingApproval.data.actionSummary}</span>
        <span>{approvalDockCount}</span>
        <button type="button" onClick={() => onRespondApproval(
          approvalDockPendingApproval.requestId,
          'approve',
          '',
          'once',
          approvalDockPendingApproval.data.callId,
        )}>允许子会话调用</button>
      </div>
    ) : null
  ),
}));
vi.mock('../components/StatusRail', () => ({ default: () => null }));
vi.mock('../components/SettingsModal', () => ({ default: () => null }));
vi.mock('../components/Toast', () => ({ default: () => null }));
vi.mock('../hooks/useChildTasks', () => ({
  default: (...args) => childTasksMock(...args),
}));
vi.mock('../components/SidePanel', () => ({
  default: ({ isOpen, isDocked, dockPreference, canDock, onToggleDock }) => (
    isOpen ? (
      <aside
        data-testid="side-panel"
        data-docked={isDocked}
        data-dock-preference={dockPreference}
        data-can-dock={canDock}
      >
        <button type="button" onClick={onToggleDock}>切换停靠</button>
      </aside>
    ) : null
  ),
}));

describe('AppLayout side panel docking', () => {
  const storageKey = 'mini-agent-web.side-panel-docked';
  const widthStorageKey = 'mini-agent-web.side-panel-width';

  beforeEach(() => {
    childTasksMock.mockReturnValue({ children: [], loading: false, error: null, refresh: vi.fn() });
    window.localStorage.removeItem(storageKey);
    window.localStorage.removeItem(widthStorageKey);
    window.innerWidth = 1400;
  });

  it('shows pending approvals from direct child Threads and hides unrelated Thread approvals', () => {
    childTasksMock.mockReturnValue({
      children: [{ child_thread_id: 'child-thread' }],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    const onRespondApproval = vi.fn();
    render(
      <AppLayout
        currentThread="parent-thread"
        currentThreadProject="project-a"
        threads={[]}
        messages={[]}
        threadItems={[]}
        pendingOtherThreadApprovals={[
          {
            requestId: 'child-approval',
            data: {
              projectId: 'project-a',
              threadId: 'child-thread',
              callId: 'child-call',
              actionSummary: 'shell command `python3 make_aligned.py`',
            },
          },
          {
            requestId: 'other-approval',
            data: {
              projectId: 'project-a',
              threadId: 'unrelated-thread',
              actionSummary: 'unrelated action',
            },
          },
        ]}
        onRespondApproval={onRespondApproval}
        userSettings={{ auto_scroll: true, word_wrap: true, font_size: 13 }}
      />,
    );

    expect(screen.getByText('shell command `python3 make_aligned.py`')).toBeTruthy();
    expect(screen.queryByText('unrelated action')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '允许子会话调用' }));
    expect(onRespondApproval).toHaveBeenCalledWith(
      'child-approval', 'approve', '', 'once', 'child-call',
    );
  });

  it('persists the dock preference, keeps the main pane alongside it, and falls back on narrow windows', async () => {
    const { container, unmount } = render(
      <AppLayout
        currentThread="parent-thread"
        threads={[]}
        messages={[]}
        threadItems={[]}
        currentThreadProject="project-a"
        userSettings={{ auto_scroll: true, word_wrap: true, font_size: 13 }}
        sidePanelOpen
        sidePanelTab="child_agents"
      />,
    );

    const panel = screen.getByTestId('side-panel');
    expect(panel.dataset.docked).toBe('false');
    expect(panel.parentElement).toBe(container.querySelector('.app-content').parentElement);

    fireEvent.click(screen.getByRole('button', { name: '切换停靠' }));
    await waitFor(() => expect(window.localStorage.getItem(storageKey)).toBe('true'));
    expect(screen.getByTestId('side-panel').dataset.docked).toBe('true');

    window.innerWidth = 900;
    fireEvent(window, new Event('resize'));
    await waitFor(() => {
      expect(screen.getByTestId('side-panel').dataset.canDock).toBe('false');
      expect(screen.getByTestId('side-panel').dataset.docked).toBe('false');
    });
    expect(screen.getByTestId('side-panel').dataset.dockPreference).toBe('true');

    unmount();
    window.innerWidth = 1400;
    render(
      <AppLayout
        currentThread="parent-thread"
        threads={[]}
        messages={[]}
        threadItems={[]}
        currentThreadProject="project-a"
        userSettings={{ auto_scroll: true, word_wrap: true, font_size: 13 }}
        sidePanelOpen
        sidePanelTab="child_agents"
      />,
    );
    expect(screen.getByTestId('side-panel').dataset.docked).toBe('true');
  });

  it('resizes and remembers the docked panel width with pointer and keyboard input', async () => {
    const { container, unmount } = render(
      <AppLayout
        currentThread="parent-thread"
        threads={[]}
        messages={[]}
        threadItems={[]}
        currentThreadProject="project-a"
        userSettings={{ auto_scroll: true, word_wrap: true, font_size: 13 }}
        sidePanelOpen
        sidePanelTab="child_agents"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '切换停靠' }));
    await waitFor(() => expect(window.localStorage.getItem(storageKey)).toBe('true'));
    const resizeHandle = screen.getByRole('separator', { name: '调整右侧面板宽度' });
    expect(resizeHandle.getAttribute('aria-valuenow')).toBe('420');

    fireEvent.pointerDown(resizeHandle, {
      pointerId: 7,
      button: 0,
      clientX: 800,
    });
    fireEvent.pointerMove(resizeHandle, {
      pointerId: 7,
      clientX: 720,
    });
    fireEvent.pointerUp(resizeHandle, { pointerId: 7 });

    expect(resizeHandle.getAttribute('aria-valuenow')).toBe('500');
    expect(window.localStorage.getItem(widthStorageKey)).toBe('500');
    expect(container.querySelector('.app-main-layout').style.getPropertyValue('--side-panel-width'))
      .toBe('500px');

    fireEvent.keyDown(resizeHandle, { key: 'ArrowLeft' });
    expect(resizeHandle.getAttribute('aria-valuenow')).toBe('516');
    expect(window.localStorage.getItem(widthStorageKey)).toBe('516');

    unmount();
    render(
      <AppLayout
        currentThread="parent-thread"
        threads={[]}
        messages={[]}
        threadItems={[]}
        currentThreadProject="project-a"
        userSettings={{ auto_scroll: true, word_wrap: true, font_size: 13 }}
        sidePanelOpen
        sidePanelTab="child_agents"
      />,
    );
    expect(screen.getByRole('separator', { name: '调整右侧面板宽度' })
      .getAttribute('aria-valuenow')).toBe('516');
  });
});
