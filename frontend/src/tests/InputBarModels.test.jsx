import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InputBar from '../components/InputBar';

const modelApi = vi.hoisted(() => ({
  getModelCatalog: vi.fn(),
  getThreadModelSettings: vi.fn(),
  updateThreadModelSettings: vi.fn(),
  getWorkspaceFiles: vi.fn(),
}));

vi.mock('../api', () => ({ api: modelApi }));

const provider = {
  id: 'deepseek',
  name: 'DeepSeek',
  enabled: true,
  baseUrl: 'http://localhost:9000/v1',
  apiKeyConfigured: true,
  models: [
    {
      id: 'deepseek-r1',
      name: 'DeepSeek R1',
      enabled: true,
      reasoningLevels: ['disabled', 'low', 'high'],
      reasoningParameterMap: { disabled: { reasoning: { effort: 'none' } } },
    },
  ],
};

const baseProps = {
  currentThread: 'thread-a',
  projectId: 'project-a',
  isGenerating: false,
  sessionReadOnly: false,
  onSendMessage: vi.fn(),
  onToast: vi.fn(),
};

describe('InputBar model controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelApi.getModelCatalog.mockResolvedValue({
      catalog: {
        providers: [provider],
        defaultModel: { providerId: 'deepseek', modelId: 'deepseek-r1' },
        defaultReasoningSelection: { kind: 'api_default' },
        projectDefaults: {},
      },
    });
    modelApi.getThreadModelSettings.mockResolvedValue({
      model_selection: null,
      reasoning_selection: null,
    });
    modelApi.updateThreadModelSettings.mockResolvedValue({
      model_selection: { providerId: 'deepseek', modelId: 'deepseek-r1' },
      reasoning_selection: { kind: 'api_default' },
    });
  });

  it('persists model and reasoning selections on the current Thread', async () => {
    render(<InputBar {...baseProps} />);

    const modelSelect = await screen.findByRole('combobox', { name: '当前会话模型' });
    expect(modelSelect.value).toBe('__default__');
    fireEvent.change(modelSelect, { target: { value: 'deepseek::deepseek-r1' } });

    await waitFor(() => expect(modelApi.updateThreadModelSettings).toHaveBeenCalledWith(
      'thread-a',
      { providerId: 'deepseek', modelId: 'deepseek-r1' },
      { kind: 'api_default' },
      { projectId: 'project-a' },
    ));

    const reasoningSelect = screen.getByRole('combobox', { name: '当前会话推理等级' });
    fireEvent.change(reasoningSelect, { target: { value: 'level:high' } });
    await waitFor(() => expect(modelApi.updateThreadModelSettings).toHaveBeenLastCalledWith(
      'thread-a',
      { providerId: 'deepseek', modelId: 'deepseek-r1' },
      { kind: 'level', value: 'high' },
      { projectId: 'project-a' },
    ));

    fireEvent.change(reasoningSelect, { target: { value: 'level:disabled' } });
    await waitFor(() => expect(modelApi.updateThreadModelSettings).toHaveBeenLastCalledWith(
      'thread-a',
      { providerId: 'deepseek', modelId: 'deepseek-r1' },
      { kind: 'level', value: 'disabled' },
      { projectId: 'project-a' },
    ));
  });

  it('blocks sending and explains missing provider credentials', async () => {
    modelApi.getModelCatalog.mockResolvedValue({
      catalog: {
        providers: [{ ...provider, apiKeyConfigured: false }],
        defaultModel: { providerId: 'deepseek', modelId: 'deepseek-r1' },
        projectDefaults: {},
      },
    });
    render(<InputBar {...baseProps} />);

    expect((await screen.findByRole('status')).textContent).toContain('尚未配置 API Key');
    const send = screen.getByRole('button', { name: '发送' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'test' } });
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(baseProps.onSendMessage).not.toHaveBeenCalled();
  });
});
