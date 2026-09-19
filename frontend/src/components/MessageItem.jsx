import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  Copy,
  FileText,
  Navigation,
  RotateCcw,
  Sparkles,
  Target,
} from 'lucide-react';
import ThinkingBlock from './ThinkingBlock';
import ToolCard from './ToolCard';
import AssistantTextBlock from './AssistantTextBlock';
import ContextCompactionGroup from './ContextCompactionGroup';
import ErrorBoundary from './ErrorBoundary';
import { groupCompactionBlocks, normalizeAssistantBlocks } from '../utils/messageState';
import {
  extractFileAttachmentNames,
  extractTextAttachmentNames,
} from '../utils/inputTrace';

export default function MessageItem({
  message,
  isLast,
  isGenerating,
  pendingApproval,
  policy = 'interactive',
  onRetryPrompt,
  turnEntry = null,
  isTurnFocused = false,
  anchorRef = null,
}) {
  const { role, text, thinking, tools = [], blocks = [], usage } = message;
  const [copied, setCopied] = useState(false);

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
  const activeBlockIndex = renderedBlocks.findLastIndex((block) => {
    const status = String(block.status || '').toLowerCase();
    return Boolean(block.isStreaming)
      || ['running', 'inprogress'].includes(status)
      || (block.type === 'skills' && (block.loading || []).length > 0);
  });
  const currentBlockIndex = activeBlockIndex === -1
    ? renderedBlocks.length - 1
    : activeBlockIndex;

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
            const isCurrentBlock = isStreamingThis && idx === currentBlockIndex;
            if (block.type === 'thinking') {
              return (
                <ThinkingBlock
                  key={block.id || `thinking_${idx}`}
                  content={block.content}
                  isStreaming={Boolean(block.isStreaming && isCurrentBlock)}
                  isCurrentBlock={isCurrentBlock}
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
                    isCurrentBlock={isCurrentBlock}
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
              <div className={`markdown-content assistant-answer ${isStreamingThis && tools.length === 0 ? 'cursor-blink' : ''}`}>
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
