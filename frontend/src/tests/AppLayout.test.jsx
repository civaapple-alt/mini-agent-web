import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppLayout from '../components/AppLayout';

vi.mock('../components/Header', () => ({ default: () => null }));
vi.mock('../components/Sidebar', () => ({ default: () => null }));
vi.mock('../components/ChatArea', () => ({ default: () => null }));
vi.mock('../components/InputBar', () => ({ default: () => null }));
vi.mock('../components/StatusRail', () => ({ default: () => null }));
vi.mock('../components/SettingsModal', () => ({ default: () => null }));
vi.mock('../components/Toast', () => ({ default: () => null }));
vi.mock('../hooks/useChildTasks', () => ({
  default: () => ({ children: [], loading: false, error: null, refresh: vi.fn() }),
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

  beforeEach(() => {
    window.localStorage.removeItem(storageKey);
    window.innerWidth = 1400;
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
});
