# 后台子会话直接询问用户

- status: implemented
- date: 2026-10-01

## 决策

子智能体可直接调用 `ask_user`。不要把未决问题经由父会话再次调用模型来回转交。
父会话负责标出哪个后台子任务正在等待回答，并提供前往该子会话的入口；实际问题、答案
和 Thread / Turn 校验继续由 App Server 管理。

Plan Mode 和访谈式技能适合用 `ask_user` 澄清重要选择。Goal Mode 默认探索并自主推进，
只在用户本人必须决定的事项阻塞进展时提问。

## 实施

- `SessionCatalog` 从执行日志投影未回答问题的 `awaiting_user_input` 布尔状态；读取问题卡仍走
  对应 Thread 的 App Server `thread/read`。
- 父会话侧栏将子问题作为 `child_user_input` attention reason，并显示“需回答”。
- 子任务面板显示“需要用户回答”和“回答问题”，点击后打开子 Thread；答复仍在子 Thread
  的既有问答卡提交，结果回到该子智能体。
- Web Studio 工作区工具清单显示默认启用的 `ask_user`；用户可按 Thread 关闭模型对它的调用能力，
  子 Thread 使用自身的工具选择。
- 待答子任务仍计入并发和顺序调度；用户可停止它，停止会取消该问题交互。父会话冻结时保留
  外部等待中的问题，不发送无效的 Turn 中断；答复后子 Session 按自身状态继续。
- 问题更新完成、工具调用结算或 Turn 结算后，投影不再提示待答。
- 定向 Session Manager 验证覆盖 `thread/read` 等待态、父会话冻结期间保留待答问题，以及通过统一子任务控制路径停止待答子任务。

## 验证

- Session journal 待答 / 工具结束投影、子任务 `thread/read` 等待状态、父会话 attention reason、
  Gateway 会话列表、子任务回答入口、侧栏标签均有离线测试。
- 受影响测试和完整验证结果详见 Harness 的同日 ask_user 实施记录；测试不调用付费 Provider。
