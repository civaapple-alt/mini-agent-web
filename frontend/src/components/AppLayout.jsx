import React, { useEffect, useRef, useState } from 'react';
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
import { getToolCallIds, pendingApprovalCallId } from '../utils/attentionTargets.js';
import { approvalIdentity } from '../utils/messageState.js';

const SIDE_PANEL_DOCK_BREAKPOINT = 1200;
const SIDE_PANEL_DOCK_STORAGE_KEY = 'mini-agent-web.side-panel-docked';
const SIDE_PANEL_WIDTH_STORAGE_KEY = 'mini-agent-web.side-panel-width';
const SIDE_PANEL_MIN_WIDTH = 320;
const SIDE_PANEL_MAX_WIDTH = 720;
const SIDE_PANEL_DEFAULT_WIDTH = 420;

function sidePanelWidthLimits(viewportWidth) {
  return {
    min: SIDE_PANEL_MIN_WIDTH,
    max: Math.max(
      SIDE_PANEL_MIN_WIDTH,
      Math.min(SIDE_PANEL_MAX_WIDTH, Math.floor(viewportWidth * 0.5)),
    ),
  };
}

function clampSidePanelWidth(width, viewportWidth) {
  const limits = sidePanelWidthLimits(viewportWidth);
  return Math.min(limits.max, Math.max(limits.min, Math.round(width)));
}

function readSidePanelWidth() {
  if (typeof window === 'undefined') return SIDE_PANEL_DEFAULT_WIDTH;
  try {
    const storedWidth = Number(window.localStorage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY));
    return Number.isFinite(storedWidth) && storedWidth > 0
      ? clampSidePanelWidth(storedWidth, window.innerWidth)
      : SIDE_PANEL_DEFAULT_WIDTH;
  } catch {
    return SIDE_PANEL_DEFAULT_WIDTH;
  }
}

function readSidePanelDockPreference() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SIDE_PANEL_DOCK_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

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
  availableProjects = [],
  onProjectsLoaded,
  currentThreadProject,
  isNewSessionLanding = false,
  sessionActive = true,
  isGenerating,
  onSelectThread,
  onNewThread,
  onForkThread,
  onCloseThread,
  onRefreshThreads,
  onToast,
  statusModel,
  contextUsage = null,
  contextCacheUsage = null,
  contextInjections = [],
  contextManifestError = null,
  planActive,
  isInterrupting,
  pendingApproval,
  pendingApprovalCount = 0,
  pendingApprovals = [],
  onContinuePlanning,
  onStartImplementation,
  onClosePlan,
  goalState,
  messages,
  threadItems,
  olderHistoryAvailable = false,
  isLoadingOlderHistory = false,
  historyPageVersion = 0,
  onLoadOlderHistory,
  lastTurnResult,
  turnTimings,
  onResumeExecution,
  resumeExecutionBusy = false,
  onReconcileExecution,
  reconcileExecutionBusy = false,
  policy,
  onSendMessage,
  userSettings,
  isLoadingHistory,
  sessionReadOnly,
  onRespondApproval,
  pendingUserQuestion,
  onRespondUserQuestion,
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
  settingsInitialTab = 'preferences',
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
  const [attentionRequest, setAttentionRequest] = useState(null);
  const attentionRequestSequenceRef = useRef(0);
  const [sidePanelDockPreference, setSidePanelDockPreference] = useState(readSidePanelDockPreference);
  const [sidePanelWidth, setSidePanelWidth] = useState(readSidePanelWidth);
  const [canDockSidePanel, setCanDockSidePanel] = useState(() => (
    typeof window === 'undefined' || window.innerWidth >= SIDE_PANEL_DOCK_BREAKPOINT
  ));
  const sidePanelWidthRef = useRef(sidePanelWidth);
  const sidePanelResizeRef = useRef(null);
  const childTasks = useChildTasks(currentThread, currentThreadProject, sessionActive);
  const timelineToolCallIds = getToolCallIds(messages || []);
  const allPendingApprovals = [...pendingApprovals];
  if (pendingApproval && !allPendingApprovals.some((approval) => (
    approvalIdentity(approval) === approvalIdentity(pendingApproval)
  ))) {
    allPendingApprovals.unshift(pendingApproval);
  }
  const timelineApprovals = allPendingApprovals.filter((approval) => {
    const callId = pendingApprovalCallId(approval);
    return Boolean(callId && timelineToolCallIds.has(callId));
  });
  const fallbackApprovals = allPendingApprovals.filter((approval) => {
    const callId = pendingApprovalCallId(approval);
    return !callId || !timelineToolCallIds.has(callId);
  });
  const handleAttentionRequestHandled = React.useCallback((requestId) => {
    setAttentionRequest((current) => current?.id === requestId ? null : current);
  }, []);
  const sidePanelDocked = sidePanelOpen && sidePanelDockPreference && canDockSidePanel;
  const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const visibleSidePanelWidth = clampSidePanelWidth(sidePanelWidth, viewportWidth);
  const sidePanelWidthLimitsForViewport = sidePanelWidthLimits(viewportWidth);

  const updateSidePanelWidth = (nextWidth) => {
    const clampedWidth = clampSidePanelWidth(nextWidth, viewportWidth);
    sidePanelWidthRef.current = clampedWidth;
    setSidePanelWidth(clampedWidth);
    return clampedWidth;
  };

  const persistSidePanelWidth = (width) => {
    try {
      window.localStorage.setItem(SIDE_PANEL_WIDTH_STORAGE_KEY, String(width));
    } catch {
      // Keep the in-memory preference when browser storage is unavailable.
    }
  };

  const handleSidePanelResizeStart = (event) => {
    if (!sidePanelDocked || event.button !== 0) return;
    sidePanelWidthRef.current = visibleSidePanelWidth;
    sidePanelResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: visibleSidePanelWidth,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const handleSidePanelResizeMove = (event) => {
    const resize = sidePanelResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    updateSidePanelWidth(resize.startWidth + resize.startX - event.clientX);
    event.preventDefault();
  };

  const finishSidePanelResize = (event) => {
    const resize = sidePanelResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    sidePanelResizeRef.current = null;
    persistSidePanelWidth(sidePanelWidthRef.current);
  };

  const handleSidePanelResizeKeyDown = (event) => {
    let nextWidth;
    if (event.key === 'ArrowLeft') nextWidth = visibleSidePanelWidth + 16;
    else if (event.key === 'ArrowRight') nextWidth = visibleSidePanelWidth - 16;
    else if (event.key === 'Home') nextWidth = sidePanelWidthLimitsForViewport.min;
    else if (event.key === 'End') nextWidth = sidePanelWidthLimitsForViewport.max;
    else return;

    event.preventDefault();
    persistSidePanelWidth(updateSidePanelWidth(nextWidth));
  };

  useEffect(() => {
    const updateViewport = () => {
      setCanDockSidePanel(window.innerWidth >= SIDE_PANEL_DOCK_BREAKPOINT);
    };
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDE_PANEL_DOCK_STORAGE_KEY, String(sidePanelDockPreference));
    } catch {
      // Keep the in-memory preference when browser storage is unavailable.
    }
  }, [sidePanelDockPreference]);

  return (
    <div className="app-container">
      <Header
        currentThread={currentThread}
        currentThreadProject={currentThreadProject}
        threadTitle={isNewSessionLanding ? '新建会话' : threadTitle}
        threadSummary={threadSummary}
        sessionId={sessionId}
        isConnected={isConnected}
        onOpenSidePanel={onOpenSidePanel}
        onOpenSettings={() => onOpenSettings?.('preferences')}
        onRenameThread={isNewSessionLanding ? undefined : onRenameCurrentThread}
        onUpdateSummary={isNewSessionLanding ? undefined : onUpdateCurrentSummary}
        onToast={onToast}
        sidebarOpen={mobileSidebarOpen}
        onToggleSidebar={() => setMobileSidebarOpen((open) => !open)}
      />

      <div
        className="app-main-layout"
        style={{ '--side-panel-width': `${visibleSidePanelWidth}px` }}
      >
        <Sidebar
          threads={threads}
          currentThread={sessionActive ? currentThread : null}
          currentThreadProject={currentThreadProject}
          onProjectsLoaded={onProjectsLoaded}
          isGenerating={isGenerating}
          isMobileOpen={mobileSidebarOpen}
          onSelectThread={(...args) => {
            setMobileSidebarOpen(false);
            onSelectThread(...args);
          }}
          onNewThread={(...args) => {
            setMobileSidebarOpen(false);
            return onNewThread(...args);
          }}
          onForkThread={onForkThread}
          onCloseThread={onCloseThread}
          onRenameThread={onRenameThread}
          onUpdateSummary={onUpdateSummary}
          onRefreshThreads={onRefreshThreads}
          onToast={onToast}
          onOpenSettings={onOpenSettings}
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
          {sessionActive && (
            <StatusRail
              status={statusModel}
              onFocusAttention={(attention) => {
                if (attention.type === 'plan_review') {
                  onOpenSidePanel('plan_view');
                  return;
                }
                attentionRequestSequenceRef.current += 1;
                setAttentionRequest({
                  id: attentionRequestSequenceRef.current,
                  type: attention.type,
                  target: attention.target,
                });
              }}
              onOpenDetails={() => onOpenSidePanel('status')}
              onOpenPlanDetails={() => onOpenSidePanel('plan_view')}
              onChangeExecution={onChangeExecution}
              onChangeContinuation={onChangeContinuation}
              onEnableAutoCopilot={onEnableAutoCopilot}
              onContinuePlanning={onContinuePlanning}
              onStartImplementation={onStartImplementation}
              onClosePlan={onClosePlan}
            />
          )}
          <ErrorBoundary title="对话区域渲染异常 (Chat Area Render Error)">
            <ChatArea
              messages={messages}
              threadItems={threadItems}
              olderHistoryAvailable={olderHistoryAvailable}
              isLoadingOlderHistory={isLoadingOlderHistory}
              historyPageVersion={historyPageVersion}
              onLoadOlderHistory={onLoadOlderHistory}
              statusModel={statusModel}
              isGenerating={isGenerating}
              pendingApproval={timelineApprovals[0] || null}
              pendingApprovals={timelineApprovals}
              pendingUserQuestion={pendingUserQuestion}
              onRespondApproval={onRespondApproval}
              onRespondUserQuestion={onRespondUserQuestion}
              attentionRequest={attentionRequest}
              onAttentionRequestHandled={handleAttentionRequestHandled}
              lastTurnResult={lastTurnResult}
              turnTimings={turnTimings}
              onResumeExecution={() => {
                if (childTasks.sessionControl?.status === 'frozen') {
                  return childTasks.controlSession('continue');
                }
                return onResumeExecution?.();
              }}
              resumeExecutionBusy={resumeExecutionBusy}
              onReconcileExecution={onReconcileExecution}
              reconcileExecutionBusy={reconcileExecutionBusy}
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
              isNewSessionLanding={isNewSessionLanding}
              availableProjects={availableProjects}
              onCreateSessionForProject={onNewThread}
            />
          </ErrorBoundary>

          <InputBar
            isGenerating={isGenerating}
            isInterrupting={isInterrupting}
            sessionReadOnly={sessionReadOnly}
            currentThread={currentThread}
            projectId={currentThreadProject}
            isNewSessionLanding={isNewSessionLanding}
            sessionActive={sessionActive}
            sessionControl={childTasks.sessionControl}
            contextUsage={contextUsage}
            contextCacheUsage={contextCacheUsage}
            hasSessionActivity={isGenerating || childTasks.children.some((child) => (
              ['queued', 'running', 'in_progress', 'awaiting_approval', 'awaiting_user_input', 'pausing', 'cancelling']
                .includes(child.status)
            ))}
            onContinueSession={() => childTasks.controlSession('continue')}
            onOpenSettings={onOpenSettings}
            pendingApproval={pendingApproval}
            pendingApprovalCount={pendingApprovalCount}
            approvalDockPendingApproval={fallbackApprovals[0] || null}
            approvalDockCount={fallbackApprovals.length}
            approvalActionsDisabled={Boolean(
              statusModel?.connection !== 'online'
                || statusModel?.sessionReadOnly
                || statusModel?.lifecycle === 'stopping'
            )}
            approvalBlockedMessage={statusModel?.connection !== 'online'
              ? '连接恢复后才能提交审批'
              : statusModel?.sessionReadOnly
                ? '当前会话只读，不能提交审批'
                : '当前 Turn 正在停止，等待运行时确认'}
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

        {sidePanelDocked && (
          <div
            className="sidepanel-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整右侧面板宽度"
            aria-valuemin={sidePanelWidthLimitsForViewport.min}
            aria-valuemax={sidePanelWidthLimitsForViewport.max}
            aria-valuenow={visibleSidePanelWidth}
            aria-valuetext={`${visibleSidePanelWidth} 像素`}
            tabIndex={0}
            onPointerDown={handleSidePanelResizeStart}
            onPointerMove={handleSidePanelResizeMove}
            onPointerUp={finishSidePanelResize}
            onPointerCancel={finishSidePanelResize}
            onLostPointerCapture={finishSidePanelResize}
            onKeyDown={handleSidePanelResizeKeyDown}
          />
        )}

        <ErrorBoundary title="侧边栏渲染异常 (Side Panel Render Error)">
          <SidePanel
            isOpen={sidePanelOpen}
            isDocked={sidePanelDocked}
            dockPreference={sidePanelDockPreference}
            canDock={canDockSidePanel}
            onToggleDock={() => setSidePanelDockPreference((docked) => !docked)}
            initialTab={sidePanelTab}
            onClose={onCloseSidePanelPanel}
            planActive={planActive}
            goalState={goalState}
            status={statusModel}
            contextUsage={contextUsage}
            contextCacheUsage={contextCacheUsage}
            contextInjections={contextInjections}
            contextManifestError={contextManifestError}
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
            sessionControl={childTasks.sessionControl}
            onSessionControl={childTasks.controlSession}
            parentTurnActive={isGenerating}
            onRefreshChildTasks={childTasks.refresh}
            onControlChildTask={childTasks.control}
          />
        </ErrorBoundary>
      </div>

      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={onCloseSettings}
        initialTab={settingsInitialTab}
        projectId={currentThreadProject}
        onToast={onToast}
        onSettingsSaved={onSettingsSaved}
      />

      <Toast toasts={toasts} onDismiss={onDismissToast} />
    </div>
  );
}
