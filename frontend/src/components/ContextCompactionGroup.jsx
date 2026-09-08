import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import './ContextCompactionGroup.css';

function statusLabel(status) {
  if (status === 'failed') return '失败';
  if (status === 'inProgress') return '进行中';
  return '已完成';
}

export default function ContextCompactionGroup({ items = [] }) {
  const [expanded, setExpanded] = useState(false);
  const count = items.length;

  return (
    <div className="context-compaction-group">
      <button
        type="button"
        className="context-compaction-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Layers size={13} className="context-compaction-icon" />
        <span>上下文压缩 ×{count}</span>
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>

      {expanded && (
        <div className="context-compaction-details" role="list">
          {items.map((item, index) => (
            <div
              className="context-compaction-detail"
              key={item.id || `compaction-detail-${index}`}
              role="listitem"
            >
              <span>{index + 1}. {statusLabel(item.status)}</span>
              {item.turnId && <code>Turn {item.turnId}</code>}
              {item.id && <code>{item.id}</code>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
