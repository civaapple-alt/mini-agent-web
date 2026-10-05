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
          reasoningParameterMap: expect.objectContaining({ high: { reasoning: { effort: 'high' } } }),
        }),
      }),
    ));
  });

  it('suggests the Kimi Code model for a Coding API endpoint', async () => {
    const codeProvider = {
      ...provider,
      id: 'kimi-code',
      name: 'Kimi Code',
      baseUrl: 'https://api.kimi.com/coding/v1',
    };
    modelApi.getModelCatalog.mockResolvedValue({
      catalog: {
        providers: [codeProvider],
        defaultModel: null,
        defaultReasoningSelection: { kind: 'api_default' },
        verifierDefaultModel: null,
        projectDefaults: {},
      },
    });

    render(<ModelSettingsPanel onToast={vi.fn()} />);
    await screen.findByText('Kimi Code');
    fireEvent.click(screen.getByRole('button', { name: '添加本地建议' }));

    expect(screen.getByPlaceholderText('供应商要求的模型 ID').value).toBe('k3-256k');
    expect(screen.getByLabelText('显示名称').value).toBe('Kimi K3 256K');
    expect(JSON.parse(screen.getByLabelText('推理参数映射（JSON）').value)).toEqual({
      low: { reasoning: { effort: 'low' } },
      high: { reasoning: { effort: 'high' } },
      max: { reasoning: { effort: 'max' } },
    });
  });

  it('offers a separate Kimi Code provider preset', async () => {
    render(<ModelSettingsPanel onToast={vi.fn()} />);
    await screen.findByText('Kimi');
    fireEvent.click(screen.getByRole('button', { name: '添加供应商' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kimi Code' }));

    expect(screen.getByLabelText('供应商名称').value).toBe('Kimi Code');
    expect(screen.getByLabelText('Base URL').value).toBe('https://api.kimi.com/coding/v1');
  });

  it('offers the GLM Coding Plan Responses base URL', async () => {
    render(<ModelSettingsPanel onToast={vi.fn()} />);
    await screen.findByText('Kimi');
    fireEvent.click(screen.getByRole('button', { name: '添加供应商' }));
    fireEvent.click(screen.getByRole('button', { name: 'GLM / Z.ai' }));

    expect(screen.getByLabelText('Base URL').value).toBe('https://open.bigmodel.cn/api/v1');
  });

  it('offers a one-click correction for the saved GLM Chat Completions URL', async () => {
    const glmProvider = {
      ...provider,
      id: 'glm',
      name: 'GLM / Z.ai',
      kind: 'glm',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    };
    modelApi.getModelCatalog.mockResolvedValue({
      catalog: {
        providers: [glmProvider],
        defaultModel: null,
        defaultReasoningSelection: { kind: 'api_default' },
        verifierDefaultModel: null,
        projectDefaults: {},
      },
    });

    render(<ModelSettingsPanel onToast={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '切换到 Responses 地址' }));

    expect(screen.getByLabelText('Base URL').value).toBe('https://open.bigmodel.cn/api/v1');
    fireEvent.click(screen.getByRole('button', { name: /保存供应商/ }));
    await waitFor(() => expect(modelApi.manageModelCatalog).toHaveBeenCalledWith(
      'upsert_provider',
      expect.objectContaining({
        provider: expect.objectContaining({
          id: 'glm',
          baseUrl: 'https://open.bigmodel.cn/api/v1',
        }),
      }),
    ));
  });

  it('matches GLM Flash against the Responses API model and reasoning settings', async () => {
    const glmProvider = {
      ...provider,
      id: 'glm',
      name: 'GLM / Z.ai',
      kind: 'glm',
    };
    modelApi.getModelCatalog.mockResolvedValue({
      catalog: {
        providers: [glmProvider],
        defaultModel: null,
        defaultReasoningSelection: { kind: 'api_default' },
        verifierDefaultModel: null,
        projectDefaults: {},
      },
    });

    render(<ModelSettingsPanel onToast={vi.fn()} />);
    await screen.findByText('GLM / Z.ai');
    fireEvent.click(screen.getByRole('button', { name: '手动添加' }));
    const idInput = screen.getByPlaceholderText('供应商要求的模型 ID');
    fireEvent.change(idInput, { target: { value: 'glm-5.3-flash' } });
    fireEvent.click(idInput.parentElement.querySelector('button'));

    expect(screen.getByLabelText('显示名称').value).toBe('GLM-5.3-Flash');
    expect(screen.getByLabelText('上下文窗口').value).toBe('1000000');
    expect(screen.getByLabelText('最大输出 Token').value).toBe('128000');
    expect(JSON.parse(screen.getByLabelText('推理参数映射（JSON）').value)).toEqual({
      low: { reasoning: { effort: 'low' } },
      high: { reasoning: { effort: 'high' } },
      max: { reasoning: { effort: 'max' } },
    });
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
