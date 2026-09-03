/**
 * Pure helper functions and definitions for slash commands.
 */

export const SLASH_COMMANDS = [
  { cmd: '/plan', desc: '开启/切换 Plan 规划探索模式' },
  { cmd: '/goal', desc: '创建并启动跨回合 Goal' },
  { cmd: '/clear', desc: '清空当前界面交互与消息历史' },
  { cmd: '/status', desc: '打开右侧诊断抽屉与环境看板' },
  { cmd: '/copy', desc: '复制模型最新的 Markdown 回复' },
  { cmd: '/cp', desc: '快捷复制模型最新回复别名' },
  { cmd: '/steer', desc: '向运行中的任务注入实时纠偏指令' },
];

/**
 * Parses and executes a slash command.
 * @returns {boolean} True if the command was recognized and handled.
 */
export function parseAndExecuteSlashCommand(cmdStr, {
  isGenerating = false,
  onTogglePlanMode,
  onStartGoal,
  onClearChat,
  onOpenStatus,
  onCopyLastResponse,
  onSteerMessage,
  onToast,
}) {
  const cleanCmd = (cmdStr || '').trim();
  const lowerCmd = cleanCmd.toLowerCase();

  if (lowerCmd === '/plan') {
    if (onTogglePlanMode) {
      onTogglePlanMode();
    }
    return true;
  }

  if (lowerCmd.startsWith('/goal')) {
    const objective = cleanCmd.slice(5).trim();
    if (!objective) {
      if (onToast) onToast('请输入 Goal 目标，例如：/goal 完成登录流程并运行测试', 'info');
      return true;
    }
    if (onStartGoal) onStartGoal(objective);
    return true;
  }

  if (lowerCmd === '/clear') {
    if (onClearChat) onClearChat();
    return true;
  }

  if (lowerCmd === '/status') {
    if (onOpenStatus) onOpenStatus();
    return true;
  }

  if (lowerCmd === '/copy' || lowerCmd === '/cp') {
    if (onCopyLastResponse) onCopyLastResponse();
    return true;
  }

  if (lowerCmd.startsWith('/steer')) {
    const steerText = cleanCmd.slice(6).trim();
    if (!isGenerating) {
      if (onToast) {
        onToast('⚠️ 无法纠偏：当前没有正在执行的任务。请在 Agent 运行时使用 /steer 注入实时纠偏指令。', 'warning');
      }
      return true;
    }
    if (!steerText) {
      return false; // Leave prompt as '/steer '
    }
    if (onSteerMessage) {
      onSteerMessage(steerText);
    }
    return true;
  }

  return false;
}
