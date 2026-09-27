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
        defaultReasoningSelection: { kind: 'api_default' },
        verifierDefaultModel: null,
        projectDefaults: {},
      },
    });
    modelApi.manageModelCatalog.mockResolvedValue({ catalog: { providers: [provider] } });
  });

  it('saves the global model together with a model-supported disabled level', async () => {
    const model = {
      id: 'kimi-k3',
      name: 'Kimi K3',
      enabled: true,
      reasoningLevels: ['disabled', 'high'],
      reasoningParameterMap: { disabled: { reasoning: { effort: 'none' } } },
    };
    const configuredProvider = { ...provider, models: [model] };
    modelApi.getModelCatalog.mockResolvedValue({
      catalog: {
        providers: [configuredProvider],
        defaultModel: null,
        defaultReasoningSelection: { kind: 'api_default' },
        verifierDefaultModel: null,
        projectDefaults: {},
      },
    });
    modelApi.manageModelCatalog.mockResolvedValue({
      catalog: {
        providers: [configuredProvider],
        defaultModel: { providerId: 'kimi', modelId: 'kimi-k3' },
        defaultReasoningSelection: { kind: 'level', value: 'disabled' },
        verifierDefaultModel: null,
        projectDefaults: {},
      },
    });

    render(<ModelSettingsPanel onToast={vi.fn()} />);
    const modelSelect = await screen.findByLabelText('全局默认模型');
    fireEvent.change(modelSelect, { target: { value: 'kimi::kimi-k3' } });
    fireEvent.change(screen.getByLabelText('全局默认推理等级'), {
      target: { value: 'level:disabled' },
    });
    fireEvent.click(screen.getByRole('button', { name: /保存默认值/ }));

    await waitFor(() => expect(modelApi.manageModelCatalog).toHaveBeenCalledWith(
      'set_defaults',
      expect.objectContaining({
        defaultModel: { providerId: 'kimi', modelId: 'kimi-k3' },
        defaultReasoningSelection: { kind: 'level', value: 'disabled' },
        verifierDefaultModel: null,
      }),
    ));
  });

  it('adds a custom reasoning level for Thread selection and maps it to provider parameters', async () => {
    render(<ModelSettingsPanel onToast={vi.fn()} />);
    await screen.findByText('Kimi');
    fireEvent.click(screen.getByRole('button', { name: '手动添加' }));
    fireEvent.change(screen.getByPlaceholderText('供应商要求的模型 ID'), {
      target: { value: 'kimi-custom' },
    });
    fireEvent.change(screen.getByLabelText('显示名称'), {
      target: { value: 'Kimi Custom' },
    });
    fireEvent.change(screen.getByLabelText('自定义推理等级'), {
      target: { value: 'balanced' },
    });
    fireEvent.click(screen.getByRole('button', { name: /添加等级/ }));
    fireEvent.change(screen.getByLabelText('推理参数映射（JSON）'), {
      target: { value: JSON.stringify({ balanced: { reasoning: { effort: 'balanced' } } }) },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存模型' }));

    await waitFor(() => expect(modelApi.manageModelCatalog).toHaveBeenCalledWith(
      'upsert_model',
      expect.objectContaining({
        providerId: 'kimi',
        model: expect.objectContaining({
          id: 'kimi-custom',
          reasoningLevels: ['balanced'],
          reasoningParameterMap: { balanced: { reasoning: { effort: 'balanced' } } },
        }),
      }),
    ));
  });

  it('matches within the selected provider and lets manual edits take ownership', async () => {
    render(<ModelSettingsPanel projectId="project-a" onToast={vi.fn()} />);
    await screen.findByText('Kimi');
    fireEvent.click(screen.getByRole('button', { name: '手动添加' }));

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
    ));
  });

  it('tests a saved model only after the user clicks the connection button', async () => {
    const model = { id: 'kimi-k3', name: 'Kimi K3', enabled: true };
    modelApi.getModelCatalog.mockResolvedValue({
      catalog: {
        providers: [{ ...provider, models: [model] }],
        defaultModel: null,
        defaultReasoningSelection: { kind: 'api_default' },
        verifierDefaultModel: null,
        projectDefaults: {},
      },
    });
    modelApi.manageModelCatalog.mockResolvedValue({
      catalog: {
        providers: [{ ...provider, models: [model] }],
        defaultModel: null,
        defaultReasoningSelection: { kind: 'api_default' },
        verifierDefaultModel: null,
        projectDefaults: {},
      },
      connectionTest: { status: 'succeeded', message: 'OK' },
    });

    render(<ModelSettingsPanel onToast={vi.fn()} />);
    const defaultModel = await screen.findByLabelText('全局默认模型');
    fireEvent.change(defaultModel, { target: { value: 'kimi::kimi-k3' } });
    const testButton = await screen.findByRole('button', { name: '测试连接' });
    await waitFor(() => expect(testButton.disabled).toBe(false));
    expect(modelApi.manageModelCatalog).not.toHaveBeenCalled();
    fireEvent.click(testButton);

    await waitFor(() => expect(modelApi.manageModelCatalog).toHaveBeenCalledWith(
      'test_connection',
      { providerId: 'kimi', modelId: 'kimi-k3' },
    ));
    expect((await screen.findByRole('status')).textContent).toContain('连接成功');
    expect(defaultModel.value).toBe('kimi::kimi-k3');
  });

  it('asks before discarding changed global defaults', async () => {
    const model = {
      id: 'kimi-k3',
      name: 'Kimi K3',
      enabled: true,
      reasoningLevels: [],
    };
    modelApi.getModelCatalog.mockResolvedValue({
      catalog: {
        providers: [{ ...provider, models: [model] }],
        defaultModel: null,
        defaultReasoningSelection: { kind: 'api_default' },
        verifierDefaultModel: null,
        projectDefaults: {},
      },
    });

    render(<ModelSettingsPanel onToast={vi.fn()} />);
    const defaultModel = await screen.findByLabelText('全局默认模型');
    fireEvent.change(defaultModel, { target: { value: 'kimi::kimi-k3' } });
    fireEvent.click(screen.getByRole('button', { name: /Kimi.*1 个模型/ }));

    const confirmation = await screen.findByRole('alertdialog');
    expect(confirmation.textContent).toContain('还有未保存的修改');
    fireEvent.click(screen.getByRole('button', { name: '丢弃修改' }));

    await waitFor(() => expect(defaultModel.value).toBe(''));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
