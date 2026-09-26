import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

function normalizeChildren(result) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.children) ? result.children : [];
}

function mergeChildUpdate(children, update) {
  const key = update.operation_id || update.child_thread_id;
  if (!key) return children;
  const index = children.findIndex((child) => (
    (update.operation_id && child.operation_id === update.operation_id)
    || (update.child_thread_id && child.child_thread_id === update.child_thread_id)
  ));
  if (index === -1) return [...children, update];
  return children.map((child, childIndex) => (
    childIndex === index ? { ...child, ...update } : child
  ));
}

export default function useChildTasks(threadId, projectId, enabled = true) {
  const [children, setChildren] = useState([]);
  const [sessionControl, setSessionControl] = useState({ status: 'running' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestEpoch = useRef(0);
  const requestController = useRef(null);
  const hasActiveChildren = useRef(false);
  const sessionControlStatus = useRef(sessionControl.status);
  sessionControlStatus.current = sessionControl.status;
  hasActiveChildren.current = children.some((child) => (
    ['queued', 'running', 'in_progress', 'awaiting_approval', 'pausing', 'cancelling']
      .includes(child.status)
  ));

  const load = useCallback(async () => {
    if (!enabled || !threadId) {
      setChildren([]);
      setSessionControl({ status: 'running' });
      setError(null);
      setLoading(false);
      return;
    }
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    requestEpoch.current += 1;
    const epoch = requestEpoch.current;
    try {
      const result = await api.listChildTasks(threadId, {
        projectId,
        signal: controller.signal,
      });
      if (epoch !== requestEpoch.current) return;
      setChildren(normalizeChildren(result));
      setSessionControl(result?.session_control || { status: 'running' });
      setError(null);
    } catch (cause) {
      if (cause?.name !== 'AbortError' && epoch === requestEpoch.current) {
        setError(cause?.message || '子任务状态加载失败');
      }
    } finally {
      if (epoch === requestEpoch.current) setLoading(false);
    }
  }, [enabled, projectId, threadId]);

  const controlSession = useCallback(async (action, requestId = null) => {
    if (!enabled || !threadId) throw new Error('当前会话不可控制');
    const result = await api.controlSession(threadId, action, {
      projectId,
      requestId: requestId || createControlRequestId(),
    });
    if (result?.session_control) setSessionControl(result.session_control);
    await load();
    if (result?.error) throw new Error(result.error);
    if (result?.errors?.length) throw new Error(result.errors.join('；'));
    return result;
  }, [enabled, load, projectId, threadId]);

  const control = useCallback(async (child, action, payload = {}) => {
    if (!enabled || !threadId) throw new Error('当前会话不可控制子任务');
    const response = await api.controlChildTask(
      threadId,
      child.child_thread_id,
      action,
      {
        projectId,
        operationId: child.operation_id,
        attempt: child.operation_attempt,
        requestId: payload.requestId || createControlRequestId(),
        prompt: payload.prompt,
        text: payload.text,
      },
    );
    const outcome = response?.outcome?.outcome;
    if (response?.child) {
      setChildren((current) => mergeChildUpdate(current, response.child));
    }
    await load();
    if (['failed', 'stale', 'skipped'].includes(outcome)) {
      const reason = response?.outcome?.error_reasons?.[child.child_thread_id];
      throw new Error(reason || controlOutcomeMessage(outcome));
    }
    return response;
  }, [enabled, load, projectId, threadId]);

  useEffect(() => {
    if (!enabled || !threadId) {
      setChildren([]);
      setLoading(false);
      setError(null);
      return undefined;
    }
    setChildren([]);
    setSessionControl({ status: 'running' });
    setLoading(true);
    setError(null);
    void load();
    const timer = window.setInterval(() => {
      if (hasActiveChildren.current || ['freezing', 'resuming'].includes(sessionControlStatus.current)) void load();
    }, 2000);
    const reconciliationTimer = window.setInterval(() => {
      if (!hasActiveChildren.current) void load();
    }, 10000);
    const handleUpdate = (event) => {
      const detail = event?.detail || {};
      if (detail.type === 'session_control_updated' || detail.sessionControl) {
        const parentThreadId = detail.threadId || detail.thread_id;
        const eventProjectId = detail.projectId || detail.project_id;
        if (parentThreadId && parentThreadId !== threadId) return;
        if (projectId && eventProjectId && eventProjectId !== projectId) return;
        if (detail.sessionControl) setSessionControl(detail.sessionControl);
        void load();
        return;
      }
      const update = detail.data || detail.child || null;
      if (!update) return;
      const parentThreadId = detail.threadId || detail.thread_id;
      const eventProjectId = detail.projectId || detail.project_id;
      if (parentThreadId && parentThreadId !== threadId) return;
      if (projectId && eventProjectId && eventProjectId !== projectId) return;
      setChildren((current) => mergeChildUpdate(current, update));
      void load();
    };
    window.addEventListener('mini-agent:child-operation-updated', handleUpdate);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(reconciliationTimer);
      window.removeEventListener('mini-agent:child-operation-updated', handleUpdate);
      requestController.current?.abort();
      requestEpoch.current += 1;
    };
  }, [enabled, load, projectId, threadId]);

  return { children, loading, error, sessionControl, refresh: load, control, controlSession };
}

function createControlRequestId() {
  if (globalThis.crypto?.randomUUID) return `web-${globalThis.crypto.randomUUID()}`;
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function controlOutcomeMessage(outcome) {
  if (outcome === 'stale') return '子任务状态已变化，请刷新后再操作';
  if (outcome === 'skipped') return '当前状态不支持此操作';
  return '服务端未能接受这次子任务操作';
}
