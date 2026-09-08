/**
 * Pure helper functions and definitions for slash commands.
 */

export const SLASH_COMMANDS = [
  { cmd: '/plan', desc: '开启/切换 Plan 规划探索模式' },
  { cmd: '/goal', desc: '填入目标后启动跨回合 Goal' },
  { cmd: '/clear', desc: '仅清空当前界面显示，不删除会话历史' },
];

/**
 * Return the composer draft used when a command is selected from the popup.
 * Selection must prepare the input; execution happens only after the user
 * submits the completed command.
 */
export function getSlashCommandDraft(command) {
  const cleanCommand = (command || '').trim().toLowerCase();
  if (cleanCommand === '/plan') {
    return cleanCommand;
  }
  if (cleanCommand === '/goal') {
    return `${cleanCommand} `;
  }
  return null;
}

/**
 * Parses and executes a slash command.
 * @returns {boolean} True if the command was recognized and handled.
 */
export function parseAndExecuteSlashCommand(cmdStr, {
  onTogglePlanMode,
  onStartGoal,
  onClearChat,
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

  return false;
}
