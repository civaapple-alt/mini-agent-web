import React, { useEffect, useState } from 'react';
import { Check, Clock3, FileCode, FileText, Folder, Image as ImageIcon, ListOrdered, Navigation, Pencil, Trash2, X } from 'lucide-react';

import './InputBar.css';

function messagePreview(item) {
  const text = (item.prompt || '').trim();
  if (text) return text;
  if (item.directive?.kind === 'goal') return '目标消息';
  if (item.directive?.kind === 'plan') return '计划消息';
  if (item.workflow?.id) return '+ ' + item.workflow.id;
  if (item.selectedSkills?.length) return item.selectedSkills.map((name) => `$${name}`).join(' ');
  if (item.images?.length) return '图片消息';
  if (item.textAttachments?.length) return '文本附件消息';
  return '空消息';
}

export default function PendingMessageDock({
  messages,
  onSteer,
  onEdit,
  onUpdate,
  onRemove,
}) {
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');

  useEffect(() => {
    if (editingId && !messages.some((item) => item.id === editingId)) {
      setEditingId(null);
      setEditingText('');
    }
  }, [editingId, messages]);

  if (!messages || messages.length === 0) return null;

  const startEditing = (item) => {
    if (messages.length === 1) {
      onEdit(item);
      return;
    }
    setEditingId(item.id);
    setEditingText(item.prompt || '');
  };

  const saveEditing = (item) => {
    const nextText = editingText.trim();
    if (!nextText && !item.images?.length && !item.textAttachments?.length && !item.fileAttachments?.length) return;
    onUpdate(item.id, nextText);
    setEditingId(null);
    setEditingText('');
  };

  return (
    <section className="composer-queue-dock" aria-label="待处理消息队列">
      <div className="queue-dock-header">
        <div className="queue-dock-title">
          <ListOrdered size={14} />
          <strong>待处理消息</strong>
          <span className="queue-count font-mono">{messages.length}</span>
        </div>
        <span className="queue-dock-hint">
          <Clock3 size={12} />
          当前任务结束后按顺序发送
        </span>
      </div>

      <div className="queue-items">
        {messages.map((item, index) => {
          const isEditing = editingId === item.id;
          return (
            <div className={`queue-item ${isEditing ? 'is-editing' : ''}`} key={item.id}>
              <span className="queue-item-index font-mono">{index + 1}</span>
              <div className="queue-item-body">
                {isEditing ? (
                  <div className="queue-inline-editor">
                    <textarea
                      value={editingText}
                      onChange={(event) => setEditingText(event.target.value)}
                      rows={2}
                      autoFocus
                      aria-label="编辑排队消息"
                    />
                    <div className="queue-inline-actions">
                      <button type="button" className="queue-save-btn" onClick={() => saveEditing(item)}>
                        <Check size={12} />
                        保存
                      </button>
                      <button
                        type="button"
                        className="queue-cancel-btn"
                        onClick={() => {
                          setEditingId(null);
                          setEditingText('');
                        }}
                      >
                        <X size={12} />
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="queue-item-main">
                      <span className="queue-item-status">
                        <Clock3 size={11} />
                        排队中
                      </span>
                      <span className="queue-item-preview" title={messagePreview(item)}>
                        {messagePreview(item)}
                      </span>
                    </div>
                    <div className="queue-item-meta">
                      {item.images?.length > 0 && (
                        <span><ImageIcon size={11} /> {item.images.length} 张图片</span>
                      )}
                      {item.referencedFiles?.length > 0 && (
                        <span><FileCode size={11} /> {item.referencedFiles.length} 个文件引用</span>
                      )}
                      {item.textAttachments?.length > 0 && (
                        <span><FileText size={11} /> {item.textAttachments.length} 个文本附件</span>
                      )}
                      {item.fileAttachments?.length > 0 && (
                        <span><Folder size={11} /> {item.fileAttachments.length} 个文件/路径</span>
                      )}
                      {item.directive?.kind === 'plan' && <span>计划模式</span>}
                      {item.directive?.kind === 'goal' && <span>目标</span>}
                    </div>
                    <div className="queue-item-actions">
                      <button
                        type="button"
                        className="queue-steer-btn"
                        onClick={() => onSteer(item)}
                        title="把这条消息作为实时纠偏发送给当前运行"
                      >
                        <Navigation size={12} />
                        实时纠偏
                      </button>
                      <button
                        type="button"
                        className="queue-edit-btn"
                        onClick={() => startEditing(item)}
                        title={messages.length === 1 ? '编辑并退回输入框' : '在队列中编辑消息'}
                      >
                        <Pencil size={12} />
                        编辑
                      </button>
                      <button
                        type="button"
                        className="queue-remove-btn"
                        onClick={() => onRemove(item.id)}
                        title="删除这条排队消息"
                        aria-label="删除排队消息"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
