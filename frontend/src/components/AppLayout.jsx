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
  const [sidePanelDockPreference, setSidePanelDockPreference] = useState(readSidePanelDockPreference);
  const [sidePanelWidth, setSidePanelWidth] = useState(readSidePanelWidth);
  const [canDockSidePanel, setCanDockSidePanel] = useState(() => (
    typeof window === 'undefined' || window.innerWidth >= SIDE_PANEL_DOCK_BREAKPOINT
  ));
  const sidePanelWidthRef = useRef(sidePanelWidth);
  const sidePanelResizeRef = useRef(null);
  const childTasks = useChildTasks(currentThread, currentThreadProject);
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

      <div
        className="app-main-layout"
        style={{ '--side-panel-width': `${visibleSidePanelWidth}px` }}
      >
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
      </div>

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
