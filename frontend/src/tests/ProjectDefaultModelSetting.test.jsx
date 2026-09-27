import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectDefaultModelSetting from '../components/ProjectDefaultModelSetting';

const modelApi = vi.hoisted(() => ({
  getModelCatalog: vi.fn(),
  manageModelCatalog: vi.fn(),
}));

vi.mock('../api', () => ({ api: modelApi }));

describe('ProjectDefaultModelSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelApi.getModelCatalog.mockResolvedValue({
      catalog: {
        providers: [{
          id: 'deepseek',
          name: 'DeepSeek',
          enabled: true,
          baseUrl: 'https://example.test',
          apiKeyConfigured: true,
          models: [{ id: 'deepseek-r1', name: 'DeepSeek R1', enabled: true }],
        }],
        projectDefaults: {},
      },
    });
    modelApi.manageModelCatalog.mockResolvedValue({
      catalog: {
        providers: [],
        projectDefaults: { 'project-a': { providerId: 'deepseek', modelId: 'deepseek-r1' } },
      },
    });
  });

  it('loads the Host catalog and saves the project default through the same model API', async () => {
    render(<ProjectDefaultModelSetting projectId="project-a" onToast={vi.fn()} />);
    const select = await screen.findByRole('combobox', { name: '项目默认模型' });
    expect(modelApi.getModelCatalog).toHaveBeenCalledWith();
    fireEvent.change(select, { target: { value: 'deepseek::deepseek-r1' } });
    fireEvent.click(screen.getByRole('button', { name: '保存项目默认模型' }));

    await waitFor(() => expect(modelApi.manageModelCatalog).toHaveBeenCalledWith(
      'set_project_default',
      {
        projectId: 'project-a',
        projectDefault: { providerId: 'deepseek', modelId: 'deepseek-r1' },
      },
      { projectId: 'project-a' },
    ));
  });
});
