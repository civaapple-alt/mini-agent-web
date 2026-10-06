import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EnvironmentToolsCard } from '../components/SidePanel';

describe('EnvironmentToolsCard', () => {
  it('separates PATH commands from an application CLI capability', () => {
    render(
      <EnvironmentToolsCard
        status={{
          available_commands: ['brew', 'python3 -m pip'],
          available_applications: [{
            id: 'blender',
            name: 'Blender',
            cli_path: '/Applications/Blender.app/Contents/MacOS/Blender',
          }],
        }}
      />,
    );

    expect(screen.getByText('检测到的命令和应用')).toBeDefined();
    expect(screen.getByText('PATH 命令')).toBeDefined();
    expect(screen.getByText(/brew/)).toBeDefined();
    expect(screen.getByText(/python3 -m pip/)).toBeDefined();
    expect(screen.getByText('应用能力')).toBeDefined();
    expect(screen.getByText('Blender')).toBeDefined();
    expect(screen.getByTitle('/Applications/Blender.app/Contents/MacOS/Blender').textContent)
      .toContain('/Applications/Blender.app/Contents/MacOS/Blender');
  });

  it('shows empty states for older or empty world-state responses', () => {
    render(<EnvironmentToolsCard status={{ available_commands: [] }} />);

    expect(screen.getByText('未检测到可用命令')).toBeDefined();
    expect(screen.getByText('未检测到额外应用能力')).toBeDefined();
  });
});
