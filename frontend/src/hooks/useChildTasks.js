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

export default function useChildTasks(threadId, projectId) {
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestEpoch = useRef(0);
  const requestController = useRef(null);
  const hasActiveChildren = useRef(false);
  hasActiveChildren.current = children.some((child) => (
    ['queued', 'running', 'in_progress', 'awaiting_approval', 'cancelling']
      .includes(child.status)
  ));

  const load = useCallback(async () => {
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
      setError(null);
    } catch (cause) {
      if (cause?.name !== 'AbortError' && epoch === requestEpoch.current) {
        setError(cause?.message || '子任务状态加载失败');
      }
    } finally {
      if (epoch === requestEpoch.current) setLoading(false);
    }
  }, [projectId, threadId]);

  useEffect(() => {
    setChildren([]);
    setLoading(true);
    setError(null);
    void load();
    const timer = window.setInterval(() => {
      if (hasActiveChildren.current) void load();
    }, 3000);
    const reconciliationTimer = window.setInterval(() => {
      if (!hasActiveChildren.current) void load();
    }, 10000);
    const handleUpdate = (event) => {
      const detail = event?.detail || {};
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
  }, [load, projectId, threadId]);

  return { children, loading, error, refresh: load };
}
