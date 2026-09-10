import React from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import ChatArea from './ChatArea';
import InputBar from './InputBar';
import SidePanel from './SidePanel';
import PlanModeBanner from './PlanModeBanner';
import SettingsModal from './SettingsModal';
import Toast from './Toast';
import ErrorBoundary from './ErrorBoundary';
import { RUNTIME_PHASE_LABELS } from '../utils/sessionState.js';

export default function AppLayout({
  currentThread,
  threadTitle,
  threadSummary,
  isConnected,
  onOpenSidePanel,
  onOpenSettings,
  onRenameThread,
  onUpdateSummary,
  onRenameCurrentThread,
  onUpdateCurrentSummary,
  threads,
  currentThreadProject,
  isGenerating,
  onSelectThread,
  onNewThread,
  onForkThread,
  onCloseThread,
  onRefreshThreads,
  onToast,
  planActive,
  planReviewPending,
  isInterrupting,
  activeTurnId,
  pendingApproval,
  onContinuePlanning,
  onStartImplementation,
  onClosePlan,
  goalState,
  onResumeGoal,
  onPauseGoal,
  onUpdateGoal,
  onClearGoal,
  runtimeStatus,
  lastWorkflowEvent,
  messages,
  lastTurnResult,
  policy,
  onSendMessage,
  userSettings,
  isLoadingHistory,
  sessionReadOnly,
  accessScope,
  continuationMode,
  onRespondApproval,
  onChangeExecution,
  onChangeContinuation,
  onEnableAutoCopilot,
  onStartPlanTask,
  onStartGoal,
  onQueueMessage,
  pendingMessages,
  onSteerQueuedMessage,
  onEditQueuedMessage,
  onUpdateQueuedMessage,
  onRemoveQueuedMessage,
  composerDraft,
  onComposerDraftApplied,
  onInterrupt,
  onClearChat,
  onTogglePlanMode,
  sidePanelOpen,
  sidePanelTab,
  onCloseSidePanelPanel,
  onGoalChanged,
  onTogglePlan,
  settingsModalOpen,
  onCloseSettings,
  onSettingsSaved,
  toasts,
  onDismissToast,
}) {
  return (
    <div className="app-container">
      <Header
        currentThread={currentThread}
        threadTitle={threadTitle}
        threadSummary={threadSummary}
        isConnected={isConnected}
        onOpenSidePanel={onOpenSidePanel}
        onOpenSettings={onOpenSettings}
        onRenameThread={onRenameCurrentThread}
        onUpdateSummary={onUpdateCurrentSummary}
      />

      <div className="app-main-layout">
        <Sidebar
          threads={threads}
          currentThread={currentThread}
          currentThreadProject={currentThreadProject}
          isGenerating={isGenerating}
          onSelectThread={onSelectThread}
          onNewThread={onNewThread}
          onForkThread={onForkThread}
          onCloseThread={onCloseThread}
          onRenameThread={onRenameThread}
          onUpdateSummary={onUpdateSummary}
          onRefreshThreads={onRefreshThreads}
          onToast={onToast}
        />

        <main className="app-content">
          {planActive && (
            <PlanModeBanner
              reviewPending={planReviewPending && !isGenerating}
              busy={isGenerating || isInterrupting || Boolean(activeTurnId) || Boolean(pendingApproval)}
              onOpenDetails={() => onOpenSidePanel('plan_goal')}
              onContinuePlanning={onContinuePlanning}
              onStartImplementation={onStartImplementation}
              onClosePlan={onClosePlan}
            />
          )}
          {goalState && (
            <div className="goal-topbar" role="status">
              <div className="goal-topbar-main">
                <span className="goal-topbar-label">GOAL</span>
                <span className={`goal-topbar-status ${goalState.status}`}>{goalState.status}</span>
                {goalState.verification_status && goalState.verification_status !== 'idle' && (
                  <span className={`goal-topbar-verification ${goalState.verification_status}`}>
                    VERIFY {goalState.verification_status}
                  </span>
                )}
                <span className="goal-topbar-objective" title={goalState.objective}>{goalState.objective}</span>
              </div>
              <div className="goal-topbar-actions">
                <button type="button" onClick={() => onOpenSidePanel('plan_goal')}>详情</button>
                {goalState.status === 'paused' ? (
                  <button type="button" onClick={onResumeGoal}>恢复</button>
                ) : goalState.status === 'active' ? (
                  <button type="button" onClick={onPauseGoal}>暂停</button>
                ) : null}
                <button type="button" onClick={onUpdateGoal}>更新</button>
                <button type="button" className="danger" onClick={onClearGoal}>删除</button>
              </div>
            </div>
          )}
          {runtimeStatus && runtimeStatus.phase !== 'idle' && (
            <div className={`runtime-status-bar ${runtimeStatus.phase}`} role="status">
              <span className="runtime-status-label">RUNTIME</span>
              <span>{RUNTIME_PHASE_LABELS[runtimeStatus.phase] || runtimeStatus.phase}</span>
              {runtimeStatus.turnId && (
                <span className="runtime-status-meta">turn {runtimeStatus.turnId}</span>
              )}
              {runtimeStatus.checkpointSeq !== null && runtimeStatus.checkpointSeq !== undefined && (
                <span className="runtime-status-meta">checkpoint #{runtimeStatus.checkpointSeq}</span>
              )}
              {runtimeStatus.operationId && (
                <span className="runtime-status-operation" title={runtimeStatus.operationId}>
                  {runtimeStatus.operationId}
                </span>
              )}
              {lastWorkflowEvent?.method && (
                <span className="runtime-status-event">{lastWorkflowEvent.method}</span>
              )}
              {runtimeStatus.error && (
                <span className="runtime-status-error" title={runtimeStatus.error}>⚠ {runtimeStatus.error}</span>
              )}
            </div>
          )}
          <ErrorBoundary title="对话区域渲染异常 (Chat Area Render Error)">
            <ChatArea
              messages={messages}
              isGenerating={isGenerating}
              pendingApproval={pendingApproval}
              lastTurnResult={lastTurnResult}
              policy={policy}
              onQuickPrompt={onSendMessage}
              onRetryPrompt={onSendMessage}
              autoScroll={userSettings.auto_scroll}
              wordWrap={userSettings.word_wrap}
              fontSize={userSettings.font_size}
              isLoadingHistory={isLoadingHistory}
            />
          </ErrorBoundary>

          <InputBar
            isGenerating={isGenerating}
            isInterrupting={isInterrupting}
            sessionReadOnly={sessionReadOnly}
            accessScope={accessScope}
            policy={policy}
            continuationMode={continuationMode}
            goalState={goalState}
            projectId={currentThreadProject}
            pendingApproval={pendingApproval}
            onRespondApproval={onRespondApproval}
            onChangeExecution={onChangeExecution}
            onChangeContinuation={onChangeContinuation}
            onEnableAutoCopilot={onEnableAutoCopilot}
            onStartPlanTask={onStartPlanTask}
            onStartGoal={onStartGoal}
            onSendMessage={onSendMessage}
            onQueueMessage={onQueueMessage}
            pendingMessages={pendingMessages}
            onSteerQueuedMessage={onSteerQueuedMessage}
            onEditQueuedMessage={onEditQueuedMessage}
            onUpdateQueuedMessage={onUpdateQueuedMessage}
            onRemoveQueuedMessage={onRemoveQueuedMessage}
            composerDraft={composerDraft}
            onComposerDraftApplied={onComposerDraftApplied}
            onInterrupt={onInterrupt}
            onClearChat={onClearChat}
            onTogglePlanMode={onTogglePlanMode}
            onToast={onToast}
          />
        </main>
      </div>

      <ErrorBoundary title="侧边栏渲染异常 (Side Panel Render Error)">
        <SidePanel
          isOpen={sidePanelOpen}
          initialTab={sidePanelTab}
          onClose={onCloseSidePanelPanel}
          planActive={planActive}
          goalState={goalState}
          threadId={currentThread}
          projectId={currentThreadProject}
          onGoalChanged={onGoalChanged}
          onTogglePlan={onTogglePlan}
          onToast={onToast}
        />
      </ErrorBoundary>

      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={onCloseSettings}
        projectId={currentThreadProject}
        onToast={onToast}
        onSettingsSaved={onSettingsSaved}
      />

      <Toast toasts={toasts} onDismiss={onDismissToast} />
    </div>
  );
}
