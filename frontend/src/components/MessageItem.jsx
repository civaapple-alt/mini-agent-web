import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Copy,
  FileText,
  Minimize2,
  Navigation,
  RotateCcw,
  Sparkles,
  Target,
} from 'lucide-react';
import ThinkingBlock from './ThinkingBlock';
import ToolCard from './ToolCard';
import AssistantTextBlock from './AssistantTextBlock';
import MarkdownRenderer from './MarkdownRenderer';
import ContextCompactionGroup from './ContextCompactionGroup';
import ErrorBoundary from './ErrorBoundary';
import ChildTaskBatchCard from './ChildTaskBatchCard';
import AssistantActivityGroup from './AssistantActivityGroup';
import { groupCompactionBlocks, normalizeAssistantBlocks } from '../utils/messageState';
import { groupSettledAssistantBlocks } from '../utils/turnHistory';
import {
  extractFileAttachmentNames,
  extractTextAttachmentNames,
} from '../utils/inputTrace';

function getCurrentExecutionSegmentStartIndex(blocks, activeBlockIndex) {
  const currentIndex = activeBlockIndex >= 0 ? activeBlockIndex : blocks.length - 1;
  if (currentIndex < 0) return 0;

  const currentBlock = blocks[currentIndex];
  if (currentBlock.type === 'thinking') return currentIndex;

  const segmentThinkingIndex = blocks.findLastIndex((block, index) => (
    index <= currentIndex && block.type === 'thinking'
  ));
  if (segmentThinkingIndex >= 0) return segmentThinkingIndex;

  const lastToolIndex = blocks.findLastIndex((block, index) => (
    index <= currentIndex && block.type === 'tool'
  ));
  if (lastToolIndex < 0) return currentIndex;

  let segmentStartIndex = lastToolIndex;
  while (segmentStartIndex > 0 && blocks[segmentStartIndex - 1].type === 'tool') {
    segmentStartIndex -= 1;
  }
  return segmentStartIndex;
}

const CONTEXT_KIND_LABELS = {
  project_instructions: '项目说明',
  skill: '技能',
  workspace_state: '工作区状态',
  other: '附加能力',
};

function formatContextInjectionBytes(bytes) {
  const value = Number(bytes);
  return Number.isSafeInteger(value) && value >= 0
    ? `${value.toLocaleString()} 字节`
    : '大小未知';
}

export default function MessageItem({
  message,
  isLast,
  isLastInTurn = isLast,
  isCurrentTurnSegment = null,
  isGenerating,
  pendingApproval,
  pendingUserQuestion = null,
  onRespondUserQuestion = null,
  policy = 'interactive',
  onRetryPrompt,
  turnEntry = null,
  isTurnFocused = false,
  anchorRef = null,
  childTaskBatch = null,
  isChildTaskTurn = false,
  modelTimingForPrompt = null,
  modelTimingDisplayedOnPrompt = false,
}) {
  const { role, text, thinking, tools = [], blocks = [], usage, modelTiming } = message;
  const formatModelTimingLabels = (timing) => [
    Number.isSafeInteger(timing?.ttftMs) ? `TTFT ${timing.ttftMs}ms` : null,
    Number.isSafeInteger(timing?.responseMs) ? `响应 ${timing.responseMs}ms` : null,
  ].filter(Boolean);
  const modelTimingLabels = formatModelTimingLabels(modelTiming);
  const promptModelTimingLabels = formatModelTimingLabels(modelTimingForPrompt);
  const [copied, setCopied] = useState(false);

  const handleCopyText = (content) => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [previewImg, setPreviewImg] = useState(null);

  useEffect(() => {
    if (!previewImg) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setPreviewImg(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [previewImg]);

  if (message.messageKind === 'goal_verification') {
    return (
      <div className="goal-verification-message" role="status">
        <Target size={13} />
        <span>{text}</span>
      </div>
    );
  }

  if (role === 'user') {
    const {
      images = [],
      referencedFiles = [],
      textAttachments = [],
      fileAttachments = [],
    } = message;
    const displayedTextAttachments = textAttachments.length > 0
      ? textAttachments
      : extractTextAttachmentNames(message.text).map((name) => ({ name }));
    const displayedFileAttachments = fileAttachments.length > 0
      ? fileAttachments
      : extractFileAttachmentNames(message.text).map((name) => ({ name }));
    return (
      <div
        ref={anchorRef}
        data-message-id={message.id}
        data-turn-id={turnEntry?.turnId || message.turnId || undefined}
        className={`message-row user ${message.isSteer ? 'steer-message-row' : ''} ${message.isGoal ? 'goal-message-row' : ''} ${isTurnFocused ? 'turn-focus-highlight' : ''}`}
      >
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
          {previewImg && typeof document !== 'undefined' && createPortal(
            <div
              className="img-lightbox-overlay"
              onClick={() => setPreviewImg(null)}
              role="dialog"
              aria-modal="true"
              aria-label="图片预览"
            >
              <button
                type="button"
                className="img-lightbox-close"
                aria-label="收起图片预览"
                title="收起图片预览"
                onClick={(event) => {
                  event.stopPropagation();
                  setPreviewImg(null);
                }}
              >
                <Minimize2 size={20} />
              </button>
              <img
                src={previewImg}
                alt="Preview"
                className="img-lightbox-image"
                onClick={() => setPreviewImg(null)}
              />
            </div>,
            document.body,
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

          {displayedTextAttachments.length > 0 && (
            <div className="user-text-attachments-row">
              {displayedTextAttachments.map((attachment, index) => (
                <span
                  key={`${attachment.name}_${index}`}
                  className="user-text-attachment-chip font-mono"
                  title={attachment.content?.slice(0, 240) || attachment.name}
                >
                  <FileText size={11} />
                  <span>{attachment.name}</span>
                </span>
              ))}
            </div>
          )}

          {displayedFileAttachments.length > 0 && (
            <div className="user-text-attachments-row">
              {displayedFileAttachments.map((attachment, index) => (
                <span
                  key={`${attachment.name}_${index}`}
                  className="user-text-attachment-chip font-mono"
                  title="本地路径或文件附件"
                >
                  <FileText size={11} />
                  <span>{attachment.name}</span>
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
                : displayedTextAttachments.length > 0
                ? '（文本附件）'
                : displayedFileAttachments.length > 0 ? '（文件附件）' : '')}
            </span>
          </div>
          {promptModelTimingLabels.length > 0 && (
            <div className="token-usage-meta user-model-timing-meta font-mono" aria-label="模型响应耗时">
              <span>{promptModelTimingLabels.join(' · ')}</span>
            </div>
          )}
          <div className="user-actions">
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
                  textAttachments,
                  fileAttachments,
                  selectedSkills: Array.isArray(message.selectedSkills)
                    ? message.selectedSkills
                    : [],
                  workflow: message.workflow || null,
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

  const isCurrentAssistantSegment = isCurrentTurnSegment === null
    ? Boolean(isLast && (isGenerating || pendingApproval))
    : Boolean(isCurrentTurnSegment);
  const isStreamingThis = isCurrentAssistantSegment && isGenerating;

  // Extract all text content from blocks or fallback text
  const fullResponseText = blocks.length > 0
    ? blocks.filter((b) => b.type === 'text').map((b) => b.content).join('\n\n')
    : text;
  const sourceBlocks = blocks.length > 0
    ? blocks
    : [
      ...(thinking
        ? [{
          type: 'thinking',
          id: `${message.id || 'assistant'}:thinking`,
          content: thinking,
          isStreaming: isStreamingThis && !text,
        }]
        : []),
      ...tools.map((tool, index) => ({
        type: 'tool',
        id: tool.id || `${message.id || 'assistant'}:tool:${index}`,
        ...tool,
      })),
      ...((text || isStreamingThis)
        ? [{
          type: 'text',
          id: `${message.id || 'assistant'}:text`,
          content: text || '',
          isStreaming: isStreamingThis,
        }]
        : []),
    ];
  const normalizedBlocks = groupCompactionBlocks(normalizeAssistantBlocks(sourceBlocks));
  const detectedActiveBlockIndex = normalizedBlocks.findLastIndex((block) => {
    const status = String(block.status || '').toLowerCase();
    return Boolean(block.isStreaming)
      || Boolean(block.approval)
      || ['running', 'inprogress', 'pending', 'queued', 'approval', 'waiting_approval', 'needs_approval']
        .includes(status)
      || (block.type === 'skills' && (block.loading || []).length > 0);
  });
  const lastThinkingBlockIndex = normalizedBlocks.findLastIndex((block) => block.type === 'thinking');
  const detectedBlockIsInCurrentSegment = detectedActiveBlockIndex >= lastThinkingBlockIndex;
  const activeBlockIndex = detectedActiveBlockIndex >= 0 && detectedBlockIsInCurrentSegment
    ? detectedActiveBlockIndex
    : isCurrentAssistantSegment && isGenerating ? normalizedBlocks.length - 1 : -1;
  const isCurrentExecutionSegmentActive = isCurrentAssistantSegment;
  const segmentCursorIndex = activeBlockIndex >= 0 ? activeBlockIndex : normalizedBlocks.length - 1;
  const lastExecutionSegmentStartIndex = normalizedBlocks.length > 0
    ? getCurrentExecutionSegmentStartIndex(normalizedBlocks, segmentCursorIndex)
    : -1;
  const preservesLastSegment = isCurrentExecutionSegmentActive || isLastInTurn;
  const uncompressedSegmentStartIndex = preservesLastSegment
    ? lastExecutionSegmentStartIndex
    : -1;
  const uncompressedExecutionSegmentBlocks = new Set(
    uncompressedSegmentStartIndex >= 0
      ? normalizedBlocks.slice(uncompressedSegmentStartIndex)
      : [],
  );
  const renderedBlocks = uncompressedSegmentStartIndex >= 0
    ? [
      ...groupSettledAssistantBlocks(normalizedBlocks.slice(0, uncompressedSegmentStartIndex)),
      ...normalizedBlocks.slice(uncompressedSegmentStartIndex),
    ]
    : groupSettledAssistantBlocks(normalizedBlocks);
  const turnScope = String(turnEntry?.turnId || message.turnId || message.id || 'assistant');
  const currentBlock = activeBlockIndex >= 0 ? normalizedBlocks[activeBlockIndex] : null;
  let childTaskBatchRendered = false;

  const renderDelegateBatch = (tool, key) => {
    if ((tool.name || tool.toolName || tool.tool) !== 'delegate_task' || !childTaskBatch?.length) {
      return null;
    }
    if (childTaskBatchRendered) return null;
    childTaskBatchRendered = true;
    return <ChildTaskBatchCard key={key} tasks={childTaskBatch} />;
  };

  const renderExecutionItem = (item, key, callId) => {
    const itemId = item.id || `${callId}:${key}`;
    if (item.type === 'thinking') {
      return (
        <ThinkingBlock
          key={itemId}
          content={item.content}
          isStreaming={false}
          presentationId={`${turnScope}:thinking:${itemId}`}
        />
      );
    }
    if (item.type === 'tool') {
      const delegateBatch = renderDelegateBatch(item, itemId);
      if (delegateBatch) return delegateBatch;
      if ((item.name || item.toolName || item.tool) === 'delegate_task' && isChildTaskTurn) {
        return null;
      }
      return (
        <ErrorBoundary
          key={itemId}
          compact
          title={`工具 [${item.name || 'tool'}] 渲染异常`}
        >
          <ToolCard
            tool={item}
            pendingApproval={null}
            pendingUserQuestion={pendingUserQuestion}
            onRespondUserQuestion={onRespondUserQuestion}
            policy={policy}
            presentationId={`${turnScope}:tool:${itemId}`}
          />
        </ErrorBoundary>
      );
    }
    if (item.type === 'text') {
      return <AssistantTextBlock key={itemId} content={item.content || ''} />;
    }
    return null;
  };

  return (
    <div
      ref={anchorRef}
      data-message-id={message.id}
      data-turn-id={turnEntry?.turnId || message.turnId || undefined}
      className={`message-row assistant ${isTurnFocused ? 'turn-focus-highlight' : ''}`}
    >
      <div className="assistant-container">
        {/* Render sequential blocks if present */}
        {renderedBlocks.length > 0 ? (
          renderedBlocks.map((block, idx) => {
            const isCurrentBlock = isCurrentExecutionSegmentActive && block === currentBlock;
            const isCurrentSegmentBlock = uncompressedExecutionSegmentBlocks.has(block);
            if (block.type === 'activityGroup') {
              return (
                <AssistantActivityGroup
                  key={block.id}
                  id={block.id}
                  presentationId={`${turnScope}:${block.id}`}
                  items={block.items}
                  failureCount={block.failureCount}
                  failureTypes={block.failureTypes}
                >
                  {block.items.map((item, itemIndex) => {
                    if (item.type === 'thinking') {
                      const blockId = item.id || `${block.id}:thinking:${itemIndex}`;
                      return (
                        <ThinkingBlock
                          key={blockId}
                          content={item.content}
                          isStreaming={false}
                          presentationId={`${turnScope}:thinking:${blockId}`}
                        />
                      );
                    }
                    if (item.type === 'tool') {
                      const blockId = item.id || `${block.id}:tool:${itemIndex}`;
                      return (
                        <ErrorBoundary
                          key={blockId}
                          compact
                          title={`工具 [${item.name || 'tool'}] 渲染异常`}
                        >
                          <ToolCard
                            tool={item}
                            pendingApproval={null}
                            pendingUserQuestion={pendingUserQuestion}
                            onRespondUserQuestion={onRespondUserQuestion}
                            presentationId={`${turnScope}:tool:${blockId}`}
                          />
                        </ErrorBoundary>
                      );
                    }
                    return null;
                  })}
                </AssistantActivityGroup>
              );
            }
            if (block.type === 'executionGroup') {
              return (
                <AssistantActivityGroup
                  key={block.id}
                  id={block.id}
                  presentationId={`${turnScope}:${block.id}`}
                  title={`已完成 ${block.calls.length} 次模型调用`}
                  items={block.items}
                  failureCount={block.failureCount}
                  failureTypes={block.failureTypes}
                  showWebActivitySummary={false}
                >
                  {block.calls.map((call, callIndex) => (
                    <AssistantActivityGroup
                      key={call.id}
                      id={`model-call:${call.id}`}
                      presentationId={`${turnScope}:model-call:${call.id}`}
                      title={`模型调用 ${callIndex + 1}`}
                      items={call.items}
                      failureCount={call.failureCount}
                      failureTypes={call.failureTypes}
                    >
                      {call.hasFinalAnswer && (
                        <div className="assistant-final-answer-call-note">
                          最终回复显示在下方
                        </div>
                      )}
                      {call.items.map((item, itemIndex) => (
                        renderExecutionItem(item, itemIndex, call.id)
                      ))}
                    </AssistantActivityGroup>
                  ))}
                </AssistantActivityGroup>
              );
            }
            if (block.type === 'thinking') {
              return (
                <ThinkingBlock
                  key={block.id || `thinking_${idx}`}
                  content={block.content}
                  isStreaming={Boolean(isStreamingThis && block.isStreaming && isCurrentBlock)}
                  isCurrentBlock={isCurrentSegmentBlock}
                  presentationId={`${turnScope}:thinking:${block.id || idx}`}
                />
              );
            }
            if (block.type === 'tool') {
              const delegateBatch = renderDelegateBatch(block, block.id || `delegate_${idx}`);
              if (delegateBatch) return delegateBatch;
              if ((block.name || block.toolName || block.tool) === 'delegate_task' && isChildTaskTurn) {
                return null;
              }
              return (
                <ErrorBoundary
                  key={block.id || `tool_${idx}`}
                  compact
                  title={`工具 [${block.name || 'tool'}] 渲染异常`}
                >
                  <ToolCard
                    tool={block}
                    pendingApproval={isCurrentAssistantSegment ? pendingApproval : null}
                    pendingUserQuestion={isCurrentAssistantSegment ? pendingUserQuestion : null}
                    onRespondUserQuestion={onRespondUserQuestion}
                    policy={policy}
                    presentationId={`${turnScope}:tool:${block.id || idx}`}
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
                <AssistantTextBlock
                  key={`text_${idx}`}
                  content={block.content || ''}
                  isCurrentBlock={isCurrentBlock}
                  isRunActive={isStreamingThis}
                />
              );
            }
            if (block.type === 'context_injected') {
              const records = block.records || [];
              return (
                <section
                  key={block.id || `context_injected_${idx}`}
                  className="context-injection-card"
                  aria-label="本轮上下文来源"
                >
                  <div className="context-injection-heading">
                    <div className="context-injection-title">
                      <FileText size={14} />
                      <strong>本轮上下文</strong>
                      <span className="context-injection-host-label">Host 注入</span>
                    </div>
                    <span className="context-injection-count">
                      {records.length ? `${records.length} 个来源` : '来源未知'}
                    </span>
                  </div>
                  {records.length === 0 ? (
                    <div className="context-injection-empty">本轮注入信息没有可显示的来源记录。</div>
                  ) : (
                    <>
                      <p className="context-injection-summary">
                        已加入本轮请求。这里只记录来源和用途，不展示正文。
                      </p>
                      <ul className="context-injection-list">
                        {records.map((record, recordIndex) => {
                          const location = [record.workspace, record.path]
                            .filter((part) => part && part !== record.source)
                            .join(' · ');
                          return (
                            <li key={`${record.id}:${record.fingerprint}`}>
                              <strong>{record.source || `上下文来源 ${recordIndex + 1}`}</strong>
                              <p>{record.scope || '已加入本轮上下文'}</p>
                              {location && <span className="context-injection-origin">来源：{location}</span>}
                            </li>
                          );
                        })}
                      </ul>
                      <details className="context-injection-metadata">
                        <summary>来源详情</summary>
                        <ul>
                          {records.map((record) => (
                            <li key={`${record.id}:${record.fingerprint}`}>
                              <strong>{record.source || '来源未知'}</strong>
                              <span>类型：{CONTEXT_KIND_LABELS[record.kind] || '上下文'}</span>
                              <span>长度：{formatContextInjectionBytes(record.bytes)}</span>
                              {record.supersedes && (
                                <span title={record.supersedes}>
                                  更新前版本：{record.supersedes.slice(0, 12)}
                                </span>
                              )}
                              {record.reused && <span>已复用已有内容</span>}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </>
                  )}
                </section>
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
                {tools.map((t, idx) => {
                  const delegateBatch = renderDelegateBatch(t, t.id || `delegate_${idx}`);
                  if (delegateBatch) return delegateBatch;
                  if ((t.name || t.toolName || t.tool) === 'delegate_task' && isChildTaskTurn) {
                    return null;
                  }
                  return (
                    <ErrorBoundary
                      key={t.id || idx}
                      compact
                      title={`工具 [${t.name || 'tool'}] 渲染异常`}
                    >
                      <ToolCard
                        tool={t}
                        pendingApproval={isCurrentAssistantSegment ? pendingApproval : null}
                        pendingUserQuestion={isCurrentAssistantSegment ? pendingUserQuestion : null}
                        onRespondUserQuestion={onRespondUserQuestion}
                        policy={policy}
                      />
                    </ErrorBoundary>
                  );
                })}
              </div>
            )}

            {(text || (isStreamingThis && tools.length === 0)) && (
              <div className={`markdown-content assistant-answer ${isStreamingThis && tools.length === 0 ? 'cursor-blink' : ''}`}>
                <MarkdownRenderer>{text || ''}</MarkdownRenderer>
              </div>
            )}
          </>
        )}

        {/* Footer actions & usage */}
        {!isCurrentAssistantSegment && isLastInTurn && fullResponseText && (
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
            {!modelTimingDisplayedOnPrompt && modelTimingLabels.length > 0 && (
              <div className="token-usage-meta font-mono" aria-label="模型响应耗时">
                <span>{modelTimingLabels.join(' · ')}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
