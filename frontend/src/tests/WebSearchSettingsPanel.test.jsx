import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import WebSearchSettingsPanel from '../components/WebSearchSettingsPanel';

const settings = {
  provider: 'none',
  deepseekApiKeyConfigured: false,
  exaApiKeyConfigured: false,
  kimiApiKeyConfigured: false,
};

afterEach(() => vi.restoreAllMocks());

describe('WebSearchSettingsPanel', () => {
  it('shows credential presence without loading or echoing a saved key', async () => {
    vi.spyOn(api, 'getWebSearchSettings').mockResolvedValue({ settings });

    const { container } = render(<WebSearchSettingsPanel />);

    expect(await screen.findByRole('combobox', { name: '搜索服务' })).toBeDefined();
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(3);
    expect([...container.querySelectorAll('input[type="password"]')]
      .every((input) => input.value === '')).toBe(true);
  });

  it('saves the selected provider and clears the key field after success', async () => {
    vi.spyOn(api, 'getWebSearchSettings').mockResolvedValue({ settings });
    const update = vi.spyOn(api, 'updateWebSearchSettings').mockResolvedValue({
      settings: { ...settings, provider: 'exa', exaApiKeyConfigured: true },
    });

    const { container } = render(<WebSearchSettingsPanel />);
    await screen.findByRole('combobox', { name: '搜索服务' });

    fireEvent.change(screen.getByLabelText('搜索服务'), { target: { value: 'exa' } });
    const keyInput = screen.getByLabelText('Exa Search API 密钥');
    fireEvent.change(keyInput, { target: { value: 'exa-secret-value' } });
    fireEvent.click(screen.getByRole('button', { name: '保存搜索设置' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith({
      provider: 'exa',
      exaApiKey: 'exa-secret-value',
    }, { projectId: null }));
    await waitFor(() => expect(keyInput.value).toBe(''));
    expect(container.textContent).not.toContain('exa-secret-value');
    expect(screen.getByText('密钥已配置')).toBeDefined();
  });
});
