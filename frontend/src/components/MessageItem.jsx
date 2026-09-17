import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Activity,
  Check,
  Copy,
  Edit3,
  History,
  Navigation,
  RotateCcw,
  Sparkles,
  Target,
} from 'lucide-react';
import ThinkingBlock from './ThinkingBlock';
import ToolCard from './ToolCard';
import ContextCompactionGroup from './ContextCompactionGroup';
import ErrorBoundary from './ErrorBoundary';
import { groupCompactionBlocks, normalizeAssistantBlocks } from '../utils/messageState';
import {
  getInputTrace,
  getInputTraceSourceLabel,
  INPUT_TRACE_ACCESS_LABELS,
  INPUT_TRACE_CONTINUATION_LABELS,
  INPUT_TRACE_POLICY_LABELS,
} from '../utils/inputTrace';

function formatTraceTimestamp(value) {
  if (!value) return '历史时间未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未记录';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function MessageItem({
  message,
  isLast,
  isGenerating,
  pendingApproval,
  policy = 'interactive',
  onRetryPrompt,
  onAdjustPrompt,
  onViewThreadHistory,
  traceScope,
}) {
  const { role, text, thinking, tools = [], blocks = [], usage } = message;
  const [copied, setCopied] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const inputTrace = getInputTrace(message, traceScope);

  const handleCopyText = (content) => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [previewImg, setPreviewImg] = useState(null);

  if (message.messageKind === 'goal_verification') {
    return (
      <div className="goal-verification-message" role="status">
        <Target size={13} />
        <span>{text}</span>
      </div>
    );
  }

  if (role === 'user') {
    const { images = [], referencedFiles = [] } = message;
    return (
      <div className={`message-row user ${message.isSteer ? 'steer-message-row' : ''} ${message.isGoal ? 'goal-message-row' : ''}`}>
        <div className="user-bubble-container">
          {/* Render Attached Images in User Bubble */}
          {images && images.length > 0 && (
            <div className="user-attached-images-grid">
              {images.map((imgUrl, i) => (
                <div key={i} className="user-img-preview-wrap">
                  <img
                    src={imgUrl}
                    alt={`Attached ${i + 1}`}
                    className="user-msg-image"
                    onClick={() => setPreviewImg(imgUrl)}
                    title="点击放大预览图片"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Image Lightbox Modal */}
          {previewImg && (
            <div
              className="img-lightbox-overlay"
              onClick={() => setPreviewImg(null)}
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'var(--overlay-strong)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                cursor: 'zoom-out',
              }}
            >
              <img
                src={previewImg}
                alt="Preview"
                style={{
                  maxWidth: '90vw',
                  maxHeight: '90vh',
                  borderRadius: '8px',
                  boxShadow: 'var(--shadow-image)',
                }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          {/* Render Referenced Files */}
          {referencedFiles && referencedFiles.length > 0 && (
            <div className="user-referenced-files-row">
              {referencedFiles.map((rf, i) => (
                <span key={i} className="user-ref-file-chip font-mono">
                  @{rf}
                </span>
              ))}
            </div>
          )}

          {message.isSteer && (
            <div className="steer-message-label font-mono">
              <Navigation size={11} />
              <span>实时纠偏</span>
              <span className="steer-message-label-separator">·</span>
              <span>已注入当前运行</span>
            </div>
          )}
          {message.isGoal && (
            <div className="goal-message-label font-mono">
              <Target size={11} />
              <span>Goal 目标</span>
              <span className="goal-message-label-separator">·</span>
              <span>已设置</span>
            </div>
          )}
          {message.workflow?.id && (
            <div className="selected-skill-chip font-mono">+ {message.workflow.id}</div>
          )}
          <div className={`user-bubble ${message.isSteer ? 'steer-bubble' : ''} ${message.isGoal ? 'goal-bubble' : ''}`}>
            <span className={message.isSteer ? 'steer-text' : message.isGoal ? 'goal-text' : ''}>
              {text || (message.selectedSkills?.length
                ? message.selectedSkills.map((name) => '$' + name).join(' ')
                : '')}
            </span>
          </div>
          <div className="user-actions">
            <div className={`user-trace-wrapper ${traceOpen ? 'trace-open' : ''}`}>
              <button
                type="button"
                className="msg-action-btn user-trace-trigger"
                aria-label="查看输入追踪"
                aria-haspopup="dialog"
                aria-expanded={traceOpen}
                title="查看输入追踪"
                onClick={() => setTraceOpen((open) => !open)}
              >
                <Activity size={11} />
              </button>
              <div className="user-trace-popover" role="dialog" aria-label="输入追踪">
                <div className="user-trace-header">
                  <span>
                    <Activity size={12} />
                    输入追踪
                  </span>
                  <span className="user-trace-source">
                    {getInputTraceSourceLabel(inputTrace.source)}
                  </span>
                </div>
                <div className="user-trace-prompt" title={text}>
                  {text || (images.length > 0 ? '（图片输入）' : '（空输入）')}
                </div>
                <dl className="user-trace-details">
                  <div>
                    <dt>作用域</dt>
                    <dd>{inputTrace.scope?.projectId || '未绑定项目'} / {inputTrace.scope?.threadId || 'default'}</dd>
                  </div>
                  <div>
                    <dt>Turn</dt>
                    <dd>{inputTrace.scope?.turnId || '提交后分配'}</dd>
                  </div>
                  <div>
                    <dt>记录时间</dt>
                    <dd>{formatTraceTimestamp(inputTrace.capturedAt)}</dd>
                  </div>
                  <div>
                    <dt>执行设置</dt>
                    <dd>
                      {inputTrace.execution
                        ? [
                          INPUT_TRACE_ACCESS_LABELS[inputTrace.execution.accessScope]
                            || inputTrace.execution.accessScope,
                          INPUT_TRACE_POLICY_LABELS[inputTrace.execution.policy]
                            || inputTrace.execution.policy,
                          INPUT_TRACE_CONTINUATION_LABELS[inputTrace.execution.continuationMode]
                            || inputTrace.execution.continuationMode,
                        ].filter(Boolean).join(' · ')
                        : '历史输入未保存提交时配置'}
                    </dd>
                  </div>
                  <div>
                    <dt>附件</dt>
                    <dd>
                      {inputTrace.attachments?.known === false
                        ? '历史投影未提供附件明细'
                        : `${inputTrace.attachments?.imageCount || 0} 张图片 · ${inputTrace.attachments?.referencedFiles?.length || 0} 个文件引用`}
                    </dd>
                  </div>
                </dl>
                {inputTrace.historical && (
                  <p className="user-trace-note">
                    这是当前 Thread 的历史投影；未持久化的执行设置不会用当前值代替。
                  </p>
                )}
                <div className="user-trace-actions">
                  {onAdjustPrompt && !message.isGoal && (
                    <button type="button" onClick={() => onAdjustPrompt(message)}>
                      <Edit3 size={11} />
                      调整输入
                    </button>
                  )}
                  {onViewThreadHistory && (
                    <button type="button" onClick={() => onViewThreadHistory(message.id)}>
                      <History size={11} />
                      查看 Thread 历史
                    </button>
                  )}
                </div>
              </div>
            </div>
            <button
              className="msg-action-btn"
              onClick={() => handleCopyText(text)}
              title="复制提问"
            >
              {copied ? <Check size={11} className="text-green" /> : <Copy size={11} />}
            </button>
            {onRetryPrompt && !message.isGoal && (
              <button
                className="msg-action-btn"
                onClick={() => onRetryPrompt({
                  prompt: text,
                  images,
                  referencedFiles,
                  selectedSkills: Array.isArray(message.selectedSkills)
                    ? message.selectedSkills
                    : [],
                })}
                title="重新发送此提示词"
              >
                <RotateCcw size={11} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isStreamingThis = isLast && isGenerating;

  // Extract all text content from blocks or fallback text
  const fullResponseText = blocks.length > 0
    ? blocks.filter((b) => b.type === 'text').map((b) => b.content).join('\n\n')
    : text;
  const renderedBlocks = groupCompactionBlocks(normalizeAssistantBlocks(blocks));

  return (
    <div className="message-row assistant">
      <div className="avatar-bot">
        <Sparkles size={13} />
      </div>

      <div className="assistant-container">
        {/* Render sequential blocks if present */}
        {renderedBlocks.length > 0 ? (
          renderedBlocks.map((block, idx) => {
            if (block.type === 'thinking') {
              return (
                <ThinkingBlock
                  key={`thinking_${idx}`}
                  content={block.content}
                  isStreaming={Boolean(block.isStreaming && isStreamingThis)}
                />
              );
            }
            if (block.type === 'tool') {
              return (
                <ErrorBoundary
                  key={block.id || `tool_${idx}`}
                  compact
                  title={`工具 [${block.name || 'tool'}] 渲染异常`}
                >
                  <ToolCard
                    tool={block}
                    pendingApproval={isLast ? pendingApproval : null}
                    policy={policy}
                  />
                </ErrorBoundary>
              );
            }
            if (block.type === 'compactionGroup') {
              return (
                <ContextCompactionGroup key={block.id || `compaction_${idx}`} items={block.items} />
              );
            }
            if (block.type === 'skills') {
              const loading = block.loading || [];
              const loaded = block.loaded || block.skills || [];
              const failed = block.failed || [];
              const statusClass = loading.length > 0
                ? 'loading'
                : failed.length > 0
                ? 'failed'
                : 'loaded';
              const label = block.workflow
                ? `已启用工作流：${block.workflow}`
                : loading.length > 0
                ? `正在加载技能：${loading.join('、')}`
                : failed.length > 0
                ? `技能加载失败：${failed.join('、')}（${block.reasonCode || 'unknown'}）`
                : loaded.length > 0
                ? `已加载技能：${loaded.join('、')}`
                : `技能加载失败（${block.reasonCode || 'unknown'}）`;
              return (
                <div key={block.id || `skills_${idx}`} className={`skills-loaded-event ${statusClass}`} role="status">
                  <Sparkles size={12} />
                  {label}
                </div>
              );
            }
            if (block.type === 'text') {
              return (
                <div
                  key={`text_${idx}`}
                  className={`markdown-content ${isStreamingThis && idx === renderedBlocks.length - 1 ? 'cursor-blink' : ''}`}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {block.content || ''}
                  </ReactMarkdown>
                </div>
              );
            }
            return null;
          })
        ) : (
          /* Backward compatibility fallback */
          <>
            {thinking && (
              <ThinkingBlock
                content={thinking}
                isStreaming={isStreamingThis && !text}
              />
            )}

            {tools.length > 0 && (
              <div className="tools-list">
                {tools.map((t, idx) => (
                  <ErrorBoundary
                    key={t.id || idx}
                    compact
                    title={`工具 [${t.name || 'tool'}] 渲染异常`}
                  >
                    <ToolCard
                      tool={t}
                      pendingApproval={isLast ? pendingApproval : null}
                      policy={policy}
                    />
                  </ErrorBoundary>
                ))}
              </div>
            )}

            {(text || (isStreamingThis && tools.length === 0)) && (
              <div className={`markdown-content ${isStreamingThis && tools.length === 0 ? 'cursor-blink' : ''}`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {text || ''}
                </ReactMarkdown>
              </div>
            )}
          </>
        )}

        {/* Footer actions & usage */}
        {!isStreamingThis && fullResponseText && (
          <div className="assistant-footer">
            <button
              className="msg-action-btn font-mono"
              onClick={() => handleCopyText(fullResponseText)}
              title="复制回复 Markdown"
            >
              {copied ? <Check size={11} className="text-green" /> : <Copy size={11} />}
              <span>{copied ? '已复制' : '复制回答'}</span>
            </button>

            {usage && (
              <div className="token-usage-meta font-mono">
                <span>Tokens: In {usage.input_tokens || 0} · Out {usage.output_tokens || 0}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
