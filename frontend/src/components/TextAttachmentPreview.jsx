import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Minimize2 } from 'lucide-react';
import { api } from '../api';

export default function TextAttachmentPreview({
  attachment,
  threadId,
  projectId,
  onClose,
}) {
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isCurrent = true;
    if (typeof attachment?.content === 'string') {
      setContent(attachment.content);
      setLoading(false);
      setError('');
      return () => { isCurrent = false; };
    }
    if (!threadId || !attachment?.attachmentId) {
      setContent(null);
      setLoading(false);
      setError('无法读取这个文本附件。');
      return () => { isCurrent = false; };
    }

    setContent(null);
    setLoading(true);
    setError('');
    api.readTextAttachment(threadId, attachment.attachmentId, { projectId })
      .then((result) => {
        if (isCurrent) setContent(typeof result?.content === 'string' ? result.content : '');
      })
      .catch((cause) => {
        if (isCurrent) setError(cause?.message || '读取文本附件失败。');
      })
      .finally(() => {
        if (isCurrent) setLoading(false);
      });

    return () => { isCurrent = false; };
  }, [attachment, projectId, threadId]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="img-lightbox-overlay text-attachment-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`文本附件预览：${attachment?.name || 'pasted-text.txt'}`}
    >
      <button
        type="button"
        className="img-lightbox-close"
        aria-label="关闭文本预览"
        title="关闭文本预览"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <Minimize2 size={20} />
      </button>
      <section
        className="text-attachment-preview"
        onClick={(event) => event.stopPropagation()}
        aria-busy={loading}
      >
        <header className="text-attachment-preview-header">
          <FileText size={16} />
          <span title={attachment?.name}>{attachment?.name || 'pasted-text.txt'}</span>
        </header>
        {loading
          ? <div className="text-attachment-preview-state" role="status">正在读取文本附件…</div>
          : error
            ? <div className="text-attachment-preview-state error" role="alert">{error}</div>
            : <pre className="text-attachment-preview-content">{content}</pre>}
      </section>
    </div>,
    document.body,
  );
}
