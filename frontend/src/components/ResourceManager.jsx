import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownUp,
  ArrowLeft,
  Cpu,
  MemoryStick,
  RefreshCw,
  Search,
  Server,
} from 'lucide-react';
import { api } from '../api.js';
import './ResourceManager.css';

const POLL_MS = 2000;
const HISTORY_POLL_MS = 10_000;

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1024 ** 2) return `${Math.round(value / 1024)} KiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

function formatRate(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 B/s';
  if (value < 1024) return `${value.toFixed(0)} B/s`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB/s`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB/s`;
}

function formatCpu(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
}

function formatDuration(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  const seconds = Math.floor(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}小时 ${minutes}分`;
  if (minutes > 0) return `${minutes}分 ${remainder}秒`;
  return `${remainder}秒`;
}

function residencyLabel(state) {
  return ({
    shared: '共享进程',
    loaded: '运行中',
    idle_grace: '空闲计时',
    checking: '检查活动',
    parking: '正在休眠',
    stopping_unconfirmed: '停止未确认',
    parked: '已休眠',
    blocked: '暂不可休眠',
    external_locked: '外部进程占用',
  })[state] || state || '未知';
}

function executionLabel(state) {
  return ({
    shared: 'Gateway 服务',
    idle: '空闲',
    running: '正在执行',
    waiting_approval: '等待审批',
    unknown: '状态未知',
  })[state] || state || '状态未知';
}

function selectionKey(row) {
  if (row.process_type === 'app_server' && row.project_id && row.thread_id) {
    return JSON.stringify(['session', row.project_id, row.thread_id]);
  }
  return row.process_key;
}

function ResourceChart({ data }) {
  const points = data.filter((item) => (
    Number.isFinite(item.timestamp)
      && Number.isFinite(item.rss_bytes)
      && Number.isFinite(item.cpu_percent)
  ));
  if (points.length < 2) {
    return <div className="resource-chart-empty">继续采样后显示最近 10 分钟趋势</div>;
  }
  const width = 680;
  const height = 150;
  const padding = 12;
  const rssValues = points.map((item) => item.rss_bytes / 1024 ** 2);
  const cpuValues = points.map((item) => item.cpu_percent);
  const rssMax = Math.max(1, ...rssValues);
  const cpuMax = Math.max(1, ...cpuValues);
  const toPolyline = (values, max) => values.map((value, index) => {
    const x = padding + (index / (values.length - 1)) * (width - padding * 2);
    const y = height - padding - (value / max) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <div className="resource-chart-wrap">
      <svg className="resource-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="内存和 CPU 最近 10 分钟趋势">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} />
        <polyline className="resource-chart-rss" points={toPolyline(rssValues, rssMax)} />
        <polyline className="resource-chart-cpu" points={toPolyline(cpuValues, cpuMax)} />
      </svg>
      <div className="resource-chart-legend">
        <span><i className="resource-chart-dot rss" />内存（最高 {rssMax.toFixed(1)} MiB）</span>
        <span><i className="resource-chart-dot cpu" />CPU（最高 {cpuMax.toFixed(1)}%）</span>
      </div>
    </div>
  );
}

export default function ResourceManager({ embedded = false }) {
  const [snapshot, setSnapshot] = useState(null);
  const [history, setHistory] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ field: 'rss_bytes', direction: 'desc' });
  const [error, setError] = useState(null);
  const [actionBusy, setActionBusy] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const processes = snapshot?.processes || [];
  const selected = processes.find((row) => selectionKey(row) === selectedKey) || null;
  const selectedHistoryKey = selected?.process_key || null;

  useEffect(() => {
    let active = true;
    let controller = null;
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await api.snapshot({ signal: controller.signal });
        if (!active) return;
        setSnapshot(next);
        setLastUpdated(Date.now());
        setError(null);
        const nextProcesses = next.processes || [];
        setSelectedKey((current) => (
          current && nextProcesses.some((row) => selectionKey(row) === current) ? current : null
        ));
      } catch (cause) {
        if (cause?.name !== 'AbortError' && active) setError(cause.message || '资源采集失败');
      }
    };
    void poll();
    const interval = window.setInterval(poll, POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      controller?.abort();
    };
  }, []);

  useEffect(() => {
    if (!selectedHistoryKey) return undefined;
    let active = true;
    let controller = null;
    const pollHistory = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const result = await api.history(selectedHistoryKey, { signal: controller.signal });
        if (active) setHistory(result.data || []);
      } catch (cause) {
        if (cause?.name !== 'AbortError' && active) setHistory([]);
      }
    };
    void pollHistory();
    const interval = window.setInterval(pollHistory, HISTORY_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
      controller?.abort();
    };
  }, [selectedHistoryKey]);

  const visibleProcesses = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = processes.filter((row) => (
      !query || [row.name, row.project_id, row.thread_id, row.title, row.pid]
        .some((value) => String(value || '').toLowerCase().includes(query))
    ));
    const direction = sort.direction === 'asc' ? 1 : -1;
    return filtered.sort((left, right) => {
      const a = Number(left[sort.field]) || 0;
      const b = Number(right[sort.field]) || 0;
      return (a - b) * direction;
    });
  }, [processes, search, sort]);
  const appServers = processes.filter((row) => row.process_type === 'app_server');
  const runningCount = appServers.filter((row) => Number.isInteger(row.pid)).length;
  const totalRss = processes.reduce((total, row) => total + (row.rss_bytes || 0), 0);

  const changeSort = (field) => {
    setSort((current) => ({
      field,
      direction: current.field === field && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const refresh = async () => {
    try {
      const next = await api.snapshot();
      setSnapshot(next);
      setLastUpdated(Date.now());
      setError(null);
    } catch (cause) {
      setError(cause.message || '资源采集失败');
    }
  };

  const park = async (row) => {
    setActionBusy(row.process_key);
    try {
      const result = await api.park(row.thread_id, row.project_id);
      if (result.status === 'blocked') {
        setError(`无法休眠：${(result.blockers || []).join('、') || '状态未确认'}`);
      } else if (result.status === 'stopping_unconfirmed') {
        setError('App Server 尚未确认退出；系统会等待进程状态确认后再允许唤醒。');
      }
      await refresh();
    } catch (cause) {
      setError(cause.message || '休眠会话失败');
    } finally {
      setActionBusy(null);
    }
  };

  const wake = async (row) => {
    setActionBusy(row.process_key);
    try {
      const result = await api.attachThread(row.thread_id, row.project_id);
      if (result.attached === false) {
        setError('该 Session 正由其他 Gateway 进程管理，当前以只读方式显示。');
      } else {
        setError(null);
      }
      await refresh();
    } catch (cause) {
      setError(cause.message || '唤醒会话失败');
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <main className={`resource-manager-page${embedded ? ' embedded' : ''}`}>
      <header className="resource-manager-header">
        {!embedded && (
          <a className="resource-back-button" href="/" aria-label="返回 Web Studio">
            <ArrowLeft size={18} />
          </a>
        )}
        <div className="resource-manager-title">
          {!embedded && <Activity size={21} />}
          <div>
            <h1>资源管理器</h1>
            <p>Gateway 与会话资源</p>
          </div>
        </div>
        <div className="resource-header-meta">
          <span>{lastUpdated ? `更新于 ${new Date(lastUpdated).toLocaleTimeString()}` : '正在连接'}</span>
          <button type="button" className="resource-icon-button" onClick={refresh} title="立即刷新">
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      {snapshot?.system_memory?.warning && (
        <div className="resource-warning" role="status">
          系统可用内存较低：{formatBytes(snapshot.system_memory.available_bytes)} / {formatBytes(snapshot.system_memory.total_bytes)}。当前只显示提醒，不会自动休眠会话。
        </div>
      )}
      {error && <div className="resource-error" role="alert">{error}</div>}

      <section className="resource-overview" aria-label="资源概览">
        <div className="resource-overview-stat">
          <Server size={16} aria-hidden="true" />
          <span><strong>{runningCount}<small> / {appServers.length}</small></strong><label>App Server（运行中 / 全部）</label></span>
        </div>
        <div className="resource-overview-stat">
          <MemoryStick size={16} aria-hidden="true" />
          <span><strong>{formatBytes(totalRss)}</strong><label>进程 RSS</label></span>
        </div>
        <div className="resource-overview-stat">
          <Cpu size={16} aria-hidden="true" />
          <span><strong>{formatCpu(processes.find((row) => row.process_type === 'gateway')?.cpu_percent)}</strong><label>Gateway CPU</label></span>
        </div>
        <span className="resource-overview-note">2 秒采样 · 保留 10 分钟趋势</span>
      </section>

      <div className="resource-toolbar">
        <label className="resource-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索项目、Thread 或 PID"
            aria-label="搜索资源"
          />
        </label>
        <span className="resource-row-count">{visibleProcesses.length} 个进程或会话</span>
      </div>

      <section className="resource-table-wrap">
        <table className="resource-table">
          <thead>
            <tr>
              <th>会话</th>
              <th>状态</th>
              <th><button type="button" onClick={() => changeSort('rss_bytes')}>内存 <ArrowDownUp size={13} /></button></th>
              <th><button type="button" onClick={() => changeSort('cpu_percent')}>CPU <ArrowDownUp size={13} /></button></th>
              <th>JSON-RPC 流量</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleProcesses.map((row) => {
              const isSelected = selectionKey(row) === selectedKey;
              const canPark = row.process_type === 'app_server'
                && Number.isInteger(row.pid)
                && row.viewer_count === 0
                && !['checking', 'parking', 'stopping_unconfirmed', 'external_locked'].includes(row.residency_state);
              const parkNeedsRecheck = (row.blockers || []).length > 0
                || row.residency_state === 'blocked'
                || row.execution_state === 'unknown';
              const canWake = row.process_type === 'app_server'
                && row.residency_state === 'parked'
                && row.can_wake !== false;
              return (
                <tr
                  key={row.process_key}
                  className={isSelected ? 'selected' : ''}
                  aria-selected={isSelected}
                  onClick={() => setSelectedKey((current) => (
                    current === selectionKey(row) ? null : selectionKey(row)
                  ))}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedKey((current) => (
                        current === selectionKey(row) ? null : selectionKey(row)
                      ));
                    }
                  }}
                >
                  <td>
                    <div className="resource-process-name">
                      <span className={`resource-process-icon ${row.process_type}`}>
                        {row.process_type === 'gateway' ? <Activity size={16} /> : <Server size={16} />}
                      </span>
                      <span>
                        <strong>{row.process_type === 'gateway' ? 'Gateway' : row.title || row.thread_id}</strong>
                        <small>{row.process_type === 'gateway' ? '共享服务进程' : `${row.project_id} · ${row.thread_id}`}</small>
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="resource-state-cell">
                      <span className={`resource-state-dot ${row.execution_state === 'running' || row.execution_state === 'waiting_approval' ? 'active' : ''}`} />
                      <strong>{residencyLabel(row.residency_state)}</strong>
                      <small>
                        {executionLabel(row.execution_state)}
                        {row.process_type === 'app_server' && Number.isInteger(row.viewer_count)
                          ? ` · ${row.viewer_count} 查看者`
                          : ''}
                      </small>
                      {row.blockers?.length > 0 && (
                        <small className="resource-row-blocker">{row.blockers.join('、')}</small>
                      )}
                    </div>
                  </td>
                  <td className="resource-number">{formatBytes(row.rss_bytes)}</td>
                  <td className="resource-number">{formatCpu(row.cpu_percent)}</td>
                  <td className="resource-rpc-cell">
                    {row.process_type === 'gateway'
                      ? '—'
                      : <><strong>{formatRate(row.bytes_per_second)}</strong><small>{(row.rpc_totals?.requests || 0).toLocaleString()} 次请求</small></>}
                  </td>
                  <td>
                    {canPark && (
                      <button
                        type="button"
                        className="resource-action-button"
                        disabled={actionBusy === row.process_key}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedKey(selectionKey(row));
                          void park(row);
                        }}
                      >{parkNeedsRecheck ? '重新检查' : '休眠'}</button>
                    )}
                    {canWake && (
                      <button
                        type="button"
                        className="resource-action-button wake"
                        disabled={actionBusy === row.process_key}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedKey(selectionKey(row));
                          void wake(row);
                        }}
                      >唤醒</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!visibleProcesses.length && (
              <tr><td className="resource-empty" colSpan="6">{error ? '暂时无法读取进程信息' : '没有匹配的进程或会话'}</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {selected && (
        <section className="resource-detail-panel">
          <div className="resource-detail-heading">
            <div>
              <h2>{selected.process_type === 'gateway' ? 'Gateway' : selected.title || selected.thread_id}</h2>
              <p>{selected.process_type === 'gateway'
                ? `PID ${selected.pid ?? '—'} · 运行 ${formatDuration(selected.uptime_seconds)}`
                : `${selected.project_id} · ${selected.thread_id} · PID ${selected.pid ?? '未加载'} · 运行 ${formatDuration(selected.uptime_seconds)}`}</p>
            </div>
            {selected.process_type === 'app_server' && selected.blockers?.length > 0 && (
              <span className="resource-blocker-label">{selected.blockers.join('、')}</span>
            )}
          </div>
          <ResourceChart data={history} />
          {selected.rpc?.methods && Object.keys(selected.rpc.methods).length > 0 && (
            <div className="resource-rpc-methods">
              <h3>JSON-RPC 方法统计</h3>
              <div className="resource-rpc-list">
                {Object.entries(selected.rpc.methods).slice(0, 10).map(([method, metrics]) => (
                  <div className="resource-rpc-method" key={method}>
                    <code>{method}</code>
                    <span>{(metrics.requests || 0).toLocaleString()} 次</span>
                    <span>{formatBytes((metrics.request_bytes || 0) + (metrics.response_bytes || 0))}</span>
                    <span>P95 {metrics.latency_p95_ms == null ? '—' : `${metrics.latency_p95_ms} ms`}</span>
                    <span>{metrics.errors || 0} 错误</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
