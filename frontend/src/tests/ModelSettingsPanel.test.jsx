import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ModelSettingsPanel from '../components/ModelSettingsPanel';

const modelApi = vi.hoisted(() => ({
  getModelCatalog: vi.fn(),
  manageModelCatalog: vi.fn(),
}));

vi.mock('../api', () => ({ api: modelApi }));

const provider = {
  id: 'kimi',
  name: 'Kimi',
  kind: 'kimi',
  baseUrl: 'https://example.test/v1',
  enabled: true,
  apiKeyConfigured: true,
  models: [],
};

describe('ModelSettingsPanel smart matching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelApi.getModelCatalog.mockResolvedValue({
      catalog: {
        providers: [provider],
        defaultModel: null,
        verifierDefaultModel: null,
        projectDefaults: {},
      },
    });
    modelApi.manageModelCatalog.mockResolvedValue({ catalog: { providers: [provider] } });
  });

  it('matches within the selected provider and lets manual edits take ownership', async () => {
    render(<ModelSettingsPanel projectId="project-a" onToast={vi.fn()} />);
    await screen.findByText('Kimi');
    fireEvent.click(screen.getByRole('button', { name: /添加模型/ }));

    const idInput = screen.getByPlaceholderText('供应商要求的模型 ID');
    const nameInput = screen.getByLabelText('显示名称');
    const matchButton = idInput.parentElement.querySelector('button');
    fireEvent.change(idInput, { target: { value: 'deepseek-flash' } });
    fireEvent.click(matchButton);
    expect(nameInput.value).toBe('');

    fireEvent.change(idInput, { target: { value: 'kimi-k3' } });
    fireEvent.click(matchButton);
    await waitFor(() => expect(nameInput.value).toBe('Kimi K3'));
    expect(screen.getByText('本地资料匹配；手动修改后将转为手动管理。')).toBeTruthy();

    fireEvent.change(nameInput, { target: { value: 'Kimi K3 自定义名称' } });
    fireEvent.click(screen.getByRole('button', { name: '保存模型' }));
    await waitFor(() => expect(modelApi.manageModelCatalog).toHaveBeenCalledWith(
      'upsert_model',
      expect.objectContaining({
        providerId: 'kimi',
        model: expect.objectContaining({
          id: 'kimi-k3',
          name: 'Kimi K3 自定义名称',
          smartManaged: false,
          reasoningParameterMap: expect.objectContaining({ high: { reasoning_effort: 'high' } }),
        }),
      }),
      { projectId: 'project-a' },
    ));
  });
});
