import React from 'react';
import { ExternalLink, FileText, Loader2, Search, ShieldAlert } from 'lucide-react';
import './WebActivitySummary.css';

function toolName(item) {
  return String(item.name || item.toolName || item.tool || item.tool_name || '').toLowerCase();
}

function outputValue(item) {
  const raw = item.output ?? item.result ?? item.content;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function isFailed(item) {
  return Boolean(item.error)
    || ['failed', 'retryable'].includes(String(item.outcome || '').toLowerCase())
    || (item.status === 'failed' && !['needs_approval', 'deferred'].includes(String(item.outcome || '').toLowerCase()));
}

function isRunning(item) {
  return ['running', 'inProgress', 'pending'].includes(item.status);
}

function ResultLinks({ results }) {
  const links = results.slice(0, 3).flatMap((result, index) => {
    const href = safeUrl(result.url);
    if (!href) return [];
    return [
      <a key={`${href}-${index}`} href={href} target="_blank" rel="noopener noreferrer" title={result.title || href}>
        <span>{result.title || new URL(href).hostname}</span>
        <ExternalLink size={10} aria-hidden="true" />
      </a>,
    ];
  });
  return links.length ? <div className="web-activity-links">{links}</div> : null;
}

export default function WebActivitySummary({ items }) {
  const searches = items.filter((item) => toolName(item) === 'web_search');
  const fetches = items.filter((item) => toolName(item) === 'web_fetch');
  if (searches.length === 0 && fetches.length === 0) return null;

  const rows = [];
  for (const item of searches) {
    const result = outputValue(item);
    const results = Array.isArray(result?.results) ? result.results : [];
    const count = Number.isInteger(result?.resultCount) ? result.resultCount : results.length;
    const failed = isFailed(item);
    const pendingApproval = item.approval?.state === 'pending';
    const running = isRunning(item);
    const label = failed
      ? '搜索失败'
      : pendingApproval
        ? '等待授权'
        : running
          ? `正在搜索${item.arguments?.query ? `「${item.arguments.query}」` : ''}`
          : `搜索到 ${count} 个网页`;
    rows.push(
      <div className={`web-activity-row ${failed ? 'failed' : ''}`} key={`search:${item.id || rows.length}`}>
        <div className="web-activity-title">
          {pendingApproval ? <ShieldAlert size={13} /> : running ? <Loader2 size={13} className="spin" /> : <Search size={13} />}
          <span>{label}</span>
        </div>
        {!failed && !running && <ResultLinks results={results} />}
      </div>,
    );
  }

  const pages = new Map();
  for (const item of fetches) {
    const result = outputValue(item);
    const url = safeUrl(result?.url || item.arguments?.url);
    if (!url) continue;
    const current = pages.get(url) || { url, title: '', running: false, failed: false, pendingApproval: false, sourceTruncated: false };
    current.title = result?.title || current.title;
    current.running = current.running || isRunning(item);
    current.failed = current.failed || isFailed(item);
    current.pendingApproval = current.pendingApproval || item.approval?.state === 'pending';
    current.sourceTruncated = current.sourceTruncated || result?.sourceTruncated === true;
    pages.set(url, current);
  }
  if (fetches.length > 0) {
    const pageList = [...pages.values()];
    const failedCount = fetches.filter(isFailed).length;
    const allFailed = failedCount === fetches.length;
    rows.push(
      <div className="web-activity-row" key="web-fetch">
        <div className="web-activity-title">
          {pageList.some((page) => page.pendingApproval)
            ? <ShieldAlert size={13} />
            : pageList.some((page) => page.running)
              ? <Loader2 size={13} className="spin" />
              : <FileText size={13} />}
          <span>{allFailed || (pageList.length > 0 && pageList.every((page) => page.failed))
            ? '浏览失败'
            : pageList.some((page) => page.pendingApproval)
            ? '等待授权'
            : pageList.some((page) => page.running)
              ? `正在浏览 ${pageList.length || fetches.length} 个页面`
              : `浏览 ${pageList.length || fetches.length} 个页面`}</span>
        </div>
        <div className="web-activity-links">
          {pageList.slice(0, 4).map((page) => (
            <a key={page.url} href={page.url} target="_blank" rel="noopener noreferrer" title={page.title || page.url}>
              <span>{page.title || new URL(page.url).hostname}</span>
              <ExternalLink size={10} aria-hidden="true" />
            </a>
          ))}
          {pageList.length > 4 && <span className="web-activity-more">+{pageList.length - 4}</span>}
          {failedCount > 0 && !allFailed && <span className="web-activity-failed">部分页面失败</span>}
          {pageList.some((page) => page.sourceTruncated) && <span className="web-activity-more">正文已截断</span>}
        </div>
      </div>,
    );
  }

  return <div className="web-activity-summary" aria-label="网页搜索活动">{rows}</div>;
}
