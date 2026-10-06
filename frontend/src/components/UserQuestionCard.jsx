import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, CircleHelp, Loader2, SkipForward } from 'lucide-react';
import './UserQuestionCard.css';

function parseToolResult(tool) {
  const raw = tool?.output ?? tool?.result ?? tool?.content;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export default function UserQuestionCard({ tool, pendingInteraction, onRespond }) {
  const [expanded, setExpanded] = useState(false);
  const [freeText, setFreeText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittingOptionId, setSubmittingOptionId] = useState(null);
  const toolId = tool?.id || tool?.callId || tool?.call_id;
  const interaction = pendingInteraction
    && (!toolId || (pendingInteraction.callId || pendingInteraction.call_id) === toolId)
    ? pendingInteraction
    : null;
  const result = useMemo(() => parseToolResult(tool), [tool]);
  const questions = interaction?.questions || result?.answers?.map((item) => ({
    id: item.questionId || item.question_id,
    prompt: item.question,
  })) || tool?.arguments?.questions || tool?.args?.questions || [];
  const answered = result?.answers || [];
  const currentIndex = interaction?.currentIndex ?? interaction?.current_index ?? 0;
  const current = interaction?.questions?.[currentIndex];
  const isActive = Boolean(interaction && !interaction.answers?.every(Boolean));
  const count = Math.max(questions.length, answered.length, 1);

  const answerLabel = (item) => {
    if (typeof item?.answerLabel === 'string') return item.answerLabel;
    const answer = item?.answer;
    if (!answer || answer.type === 'skipped') return '已跳过';
    if (answer.type === 'text') return answer.text || '（空回答）';
    const selected = item?.options?.find((option) => option.id === (answer.optionId || answer.option_id));
    return selected?.label || answer.optionId || answer.option_id || '已选择选项';
  };

  const submit = async (questionId, answer) => {
    if (!onRespond || !interaction || submitting) return;
    setSubmitting(true);
    setSubmittingOptionId(answer.type === 'option' ? answer.optionId : null);
    try {
      const result = await onRespond({ interaction, questionId, answer });
      if (result?.accepted) setFreeText('');
    } finally {
      setSubmitting(false);
      setSubmittingOptionId(null);
    }
  };

  if (isActive && current) {
    return (
      <section className="user-question-card active" aria-label="Agent 提问">
        <header className="user-question-card-header">
          <CircleHelp size={15} />
          <strong>正在询问问题</strong>
          <span>{currentIndex + 1} / {interaction.questions.length}</span>
        </header>
        <div className="user-question-prompt">{current.prompt}</div>
        {current.options?.length > 0 && (
          <div className="user-question-options" role="group" aria-label="回答选项">
            {current.options.map((option) => (
              <button
                className="user-question-option"
                key={option.id}
                type="button"
                disabled={submitting}
                aria-busy={submittingOptionId === option.id}
                onClick={() => submit(current.id, { type: 'option', optionId: option.id })}
              >
                <span className="user-question-option-copy">
                  <span className="user-question-option-title">
                    {option.label}
                    {option.recommended && <span className="user-question-recommended">推荐</span>}
                  </span>
                  {(option.description || (option.recommended && option.recommendationReason)) && (
                    <span className="user-question-option-description">
                      {option.description}
                      {option.recommended && option.recommendationReason && (
                        <span className="user-question-reason">推荐理由：{option.recommendationReason}</span>
                      )}
                    </span>
                  )}
                </span>
                {submittingOptionId === option.id && (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
        )}
        {current.allowFreeText && (
          <form
            className="user-question-free-text"
            onSubmit={(event) => {
              event.preventDefault();
              const text = freeText.trim();
              if (text) void submit(current.id, { type: 'text', text });
            }}
          >
            <input
              aria-label="输入自己的回答"
              value={freeText}
              maxLength={4000}
              onChange={(event) => setFreeText(event.target.value)}
              placeholder="输入自己的回答…"
              disabled={submitting}
            />
            <button type="submit" disabled={submitting || !freeText.trim()}>发送</button>
          </form>
        )}
        {current.allowSkip && (
          <button
            type="button"
            className="user-question-skip"
            disabled={submitting}
            onClick={() => submit(current.id, { type: 'skipped' })}
          >
            <SkipForward size={13} /> 跳过此题
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="user-question-card history">
      <button
        type="button"
        className="user-question-history-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <CircleHelp size={14} />
        <strong>{interaction?.isComplete || interaction?.is_complete ? '已询问' : tool?.status === 'running' || tool?.status === 'inProgress' ? '正在准备问题' : '已询问'} {count} 个问题</strong>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <ol className="user-question-history-list">
          {(answered.length ? answered : questions).map((item, index) => (
            <li key={item.questionId || item.question_id || item.id || index}>
              <span className="user-question-history-prompt">{item.question || item.prompt || '问题'}</span>
              <span className="user-question-history-answer">
                {answered.length ? answerLabel(item) : '尚未回答'}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
