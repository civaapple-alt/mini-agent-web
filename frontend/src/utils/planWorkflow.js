export const IMPLEMENTATION_PROMPT = '请根据当前计划直接开始实施。读取并执行计划中的任务，完成后进行必要验证。';

export function buildImplementationTurn() {
  return {
    prompt: IMPLEMENTATION_PROMPT,
    images: [],
    referencedFiles: [],
    selectedSkills: [],
  };
}

export async function startImplementationTurn({ disablePlanMode, sendTurn }) {
  const disabled = await disablePlanMode();
  if (!disabled) return false;
  return Boolean(sendTurn(buildImplementationTurn()));
}
