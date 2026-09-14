# Web Studio 实际 Session ID 展示

## 背景

Web Studio 原先只显示可编辑的 Thread 标题。标题适合阅读，但不能区分同一
Project/Thread 下的恢复 Session、锁定 Session 或历史 Session，排查加载和恢复
问题时还需要打开 Gateway 状态或 SessionStore 目录。

## 决策

- Header 在当前会话标题下显示后端返回的 canonical `session_id`；
- 项目会话树同时显示该 ID，悬停标签保留完整值；
- 侧栏搜索同时匹配 Session ID；
- Session ID 只作为展示和诊断信息，Thread ID 继续作为逻辑路由身份；
- 前端从现有线程目录和历史响应读取 `session_id`，不新增 REST/WebSocket 字段。

## 验证

- Header 和 ThreadRow 组件测试覆盖标题与实际 Session ID 同时展示；
- 新建、切换、启动恢复和读取历史时同步当前 `session_id`；
- 通过 Web Studio 前端 lint、单元测试和生产构建验证。
