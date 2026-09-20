import React, { useState } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import ChatArea from './ChatArea';
import InputBar from './InputBar';
import SidePanel from './SidePanel';
import StatusRail from './StatusRail';
import SettingsModal from './SettingsModal';
import Toast from './Toast';
import ErrorBoundary from './ErrorBoundary';
import useChildTasks from '../hooks/useChildTasks';

export default function AppLayout({
  currentThread,
  threadTitle,
  threadSummary,
  sessionId,
  sessionMeta,
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
  statusModel,
  planActive,
  isInterrupting,
  pendingApproval,
  pendingApprovalCount = 0,
  onContinuePlanning,
  onStartImplementation,
  onClosePlan,
  goalState,
  messages,
  threadItems,
  lastTurnResult,
  policy,
  onSendMessage,
  userSettings,
  isLoadingHistory,
  sessionReadOnly,
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
  skillCatalog = [],
  skillGroups = [],
  skillsLoading = false,
  skillsError = null,
  onToggleSkillGroup,
  onInsertSkill,
  skillInsertion,
  onSkillInsertionApplied,
}) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const childTasks = useChildTasks(currentThread, currentThreadProject);

  return (
    <div className="app-container">
      <Header
        currentThread={currentThread}
        threadTitle={threadTitle}
        threadSummary={threadSummary}
        sessionId={sessionId}
        isConnected={isConnected}
        onOpenSidePanel={onOpenSidePanel}
        onOpenSettings={onOpenSettings}
        onRenameThread={onRenameCurrentThread}
        onUpdateSummary={onUpdateCurrentSummary}
        onToast={onToast}
        sidebarOpen={mobileSidebarOpen}
        onToggleSidebar={() => setMobileSidebarOpen((open) => !open)}
      />

      <div className="app-main-layout">
        <Sidebar
          threads={threads}
          currentThread={currentThread}
          currentThreadProject={currentThreadProject}
          isGenerating={isGenerating}
          isMobileOpen={mobileSidebarOpen}
          onSelectThread={(...args) => {
            setMobileSidebarOpen(false);
            onSelectThread(...args);
          }}
          onNewThread={() => {
            setMobileSidebarOpen(false);
            onNewThread();
          }}
          onForkThread={onForkThread}
          onCloseThread={onCloseThread}
          onRenameThread={onRenameThread}
          onUpdateSummary={onUpdateSummary}
          onRefreshThreads={onRefreshThreads}
          onToast={onToast}
        />
        {mobileSidebarOpen && (
          <button
            type="button"
            className="mobile-sidebar-backdrop"
            aria-label="关闭会话导航"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}

        <main className="app-content">
          <StatusRail
            status={statusModel}
            onOpenDetails={() => onOpenSidePanel('status')}
            onOpenPlanDetails={() => onOpenSidePanel('plan_view')}
            onChangeExecution={onChangeExecution}
            onChangeContinuation={onChangeContinuation}
            onEnableAutoCopilot={onEnableAutoCopilot}
            onContinuePlanning={onContinuePlanning}
            onStartImplementation={onStartImplementation}
            onClosePlan={onClosePlan}
          />
          <ErrorBoundary title="对话区域渲染异常 (Chat Area Render Error)">
            <ChatArea
              messages={messages}
              threadItems={threadItems}
              statusModel={statusModel}
              isGenerating={isGenerating}
              pendingApproval={pendingApproval}
              lastTurnResult={lastTurnResult}
              policy={policy}
              onQuickPrompt={onSendMessage}
              onRetryPrompt={onSendMessage}
              traceScope={{
                threadId: currentThread,
                projectId: currentThreadProject,
              }}
              autoScroll={userSettings.auto_scroll}
              wordWrap={userSettings.word_wrap}
              fontSize={userSettings.font_size}
              isLoadingHistory={isLoadingHistory}
              childTasks={childTasks.children}
            />
          </ErrorBoundary>

          <InputBar
            isGenerating={isGenerating}
            isInterrupting={isInterrupting}
            sessionReadOnly={sessionReadOnly}
            projectId={currentThreadProject}
            pendingApproval={pendingApproval}
            pendingApprovalCount={pendingApprovalCount}
            onRespondApproval={onRespondApproval}
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
            availableSkills={skillCatalog}
            skillGroups={skillGroups}
            skillsLoading={skillsLoading}
            skillsError={skillsError}
            skillInsertion={skillInsertion}
            onSkillInsertionApplied={onSkillInsertionApplied}
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
          status={statusModel}
          lastTurnResult={lastTurnResult}
          sessionMeta={sessionMeta}
          threadId={currentThread}
          projectId={currentThreadProject}
          onGoalChanged={onGoalChanged}
          onTogglePlan={onTogglePlan}
          onToast={onToast}
          availableSkills={skillCatalog}
          skillGroups={skillGroups}
          skillsLoading={skillsLoading}
          skillsError={skillsError}
          onToggleSkillGroup={onToggleSkillGroup}
          onInsertSkill={onInsertSkill}
          childTasks={childTasks.children}
          childTasksLoading={childTasks.loading}
          childTasksError={childTasks.error}
          onRefreshChildTasks={childTasks.refresh}
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
