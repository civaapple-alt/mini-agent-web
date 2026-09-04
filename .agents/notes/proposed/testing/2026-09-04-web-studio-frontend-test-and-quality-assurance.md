# Web Studio 前端测试体系与质量保障体系演进提案

- **日期**：2026-09-04
- **状态**：推进实施中 (In Progress)
- **作者**：Web Studio Quality Team
- **范围**：`frontend/` (React SPA), `server/` (Gateway Integration), 全栈自动化冒烟

---

## 1. 背景与问题复盘

### 1.1 典型缺陷案例：`7e0b06e8`
在提交 `7e0b06e8e0e5fefbc023901d269904120a495f7c` 中，修复了 `ToolCard.jsx` 漏导入 `CheckCheck` 图标的问题：
```diff
--- a/frontend/src/components/ToolCard.jsx
+++ b/frontend/src/components/ToolCard.jsx
@@ -11,6 +11,7 @@ import {
   ChevronRight,
   Copy,
   Check,
+  CheckCheck,
   Loader2,
```

### 1.2 现有门禁失效原因分析
在 `7e0b06e8` 修复前，执行全部常规检查：
- `npm --prefix frontend run build` -> **PASS (Exit 0)**
- `npm --prefix frontend test` -> **PASS (12/12 tests passed)**
- `uv run pytest -q` -> **PASS (48/48 passed)**

但实际在浏览器中操作时，一旦工具卡片处于敏感操作授权状态，页面直接抛出 `ReferenceError: CheckCheck is not defined` 导致组件或整个页面白屏崩溃。

**根本原因归结为三点**：
1. **构建工具转译局限**：Vite 依赖 esbuild 将 JSX 转译为 `_jsx(CheckCheck, {})` 函数调用，esbuild 默认将未声明标识符视为外部或全局变量，构建过程不进行全局作用域符号解析；
2. **测试层级缺失（零组件挂载）**：现有 `src/tests/*.test.js` 仅覆盖纯 JavaScript 数据处理函数（如正则解析、消息序列化），**前端 19 个 React 组件从未在任何自动化测试中被实际挂载（Mount）与渲染**；
3. **缺少静态代码扫描器（Linter）**：前端没有配置 ESLint 或类型检查器，缺少关键规则 `no-undef` 与 `react/jsx-no-undef`。

---

## 2. 目标与设计原则

1. **零未导入/拼写逃逸**：所有未导入符号、变量拼写错误、非法属性访问在编写或保存时 100% 静态拦截（耗时 < 1 秒）；
2. **组件状态全覆盖**：关键交互组件（`ToolCard`、`InputBar`、`Sidebar`）在各种运行时状态（审批请求、流式生成、错误终态）下必须具备可复现的挂载测试；
3. **真实无头浏览器 E2E 兜底**：通过无头浏览器自动监听控制台错误（Console Error），杜绝“必须人工肉眼点开浏览器才能发现问题”；
4. **运行时优雅降级**：引入 React ErrorBoundary，杜绝单个组件局部异常导致整个 Web Studio 白屏崩溃。

---

## 3. 四层防御体系架构

```text
┌─────────────────────────────────────────────────────────────┐
│  第 1 道防线：静态代码扫描 (ESLint + JSX no-undef)          │  耗时: ~0.5s (编译保存即报错)
│  → 拦截：未声明标识符、未导入组件/图标、未定义变量         │
├─────────────────────────────────────────────────────────────┤
│  第 2 道防线：组件级挂载测试 (Vitest + React Testing Library)│  耗时: ~1-2s (免浏览器无头测试)
│  → 拦截：组件在各业务状态分支下的挂载异常与 DOM 点击逻辑     │
├─────────────────────────────────────────────────────────────┤
│  第 3 道防线：无头浏览器 E2E 自动化测试 (Playwright)        │  耗时: ~5s (全真浏览器内核运行)
│  → 拦截：全流程用户交互崩溃、控制台未捕获异常、页面白屏     │
├─────────────────────────────────────────────────────────────┤
│  第 4 道防线：运行时兜底容错 (React Error Boundary)         │  保障：单卡片崩溃不影响整页可用
└─────────────────────────────────────────────────────────────┘
```

### 3.1 第一层：静态代码扫描（ESLint）
- **配置规则**：
  - `no-undef`: 开启未声明变量拦截；
  - `react/jsx-no-undef`: 专门针对 JSX 标签，严格禁止使用任何未 import 的组件或图标；
  - `no-unused-vars`: 清理死变量与遗留参数；
- **集成命令**：`npm --prefix frontend run lint`，纳入 CI 与本地前置校验。

### 3.2 第二层：组件挂载与交互测试
- **工具链**：`vitest` + `@testing-library/react` + `jsdom`；
- **核心覆盖组件**：
  - `ToolCard.jsx`：覆盖 `approval_requested`、`running`、`completed`、`denied` 四大状态，模拟用户点击 Approve/Deny 按钮；
  - `InputBar.jsx`：覆盖模式切换（Chat/Plan/Goal）、Prompt 提交、附件添加交互；
  - `ChatArea.jsx` / `MessageItem.jsx`：覆盖思考折叠、Markdown 代码块、工具调用聚合；
- **效果**：任何组件内漏导入或属性空访问错误在测试挂载瞬间直接失败。

### 3.3 第三层：无头浏览器 E2E 自动化测试
- **工具链**：Playwright Headless Chrome；
- **核心机制**：
  - 全局监听页面未捕获错误：捕获 `console.error` 与 `pageerror`，有任何报错直接判负；
  - 启动真实网关或 Vite 静态服务，自动发起请求并等待 DOM 元素渲染；
  - 自动模拟点击侧边栏、切换会话、发起测试任务、点击审批按钮；
  - 发现白屏或控制台报错立即截屏并报错失败。

### 3.4 第四层：运行时兜底容错（Error Boundary）
- **实现**：新增 `frontend/src/components/ErrorBoundary.jsx`；
- **作用域**：
  - 在 `App.jsx` 顶层包裹页面级错误边界；
  - 在 `ToolCard.jsx`、`MessageItem.jsx` 等卡片级包裹局部错误边界；
- **效果**：万一未来遇到极端意外数据，仅出问题的卡片展示错误提示，输入框、聊天列表、侧边栏依然可用，绝不白屏。

---

## 4. 实施与推进计划

- [x] **阶段 1（即刻落地）**：配置 ESLint 静态代码扫描体系，启用 `no-undef` 与 `react/jsx-no-undef`，验证现有全部代码干净度；
- [x] **阶段 2（即刻落地）**：实现 `ErrorBoundary` 容错组件并包裹核心交互视图，消除全站白屏风险；
- [x] **阶段 3（即刻落地）**：引入组件渲染挂载测试（`vitest` + `@testing-library/react`），已为 `ToolCard`（成功/运行中/失败/审批等各状态）与 `ErrorBoundary` 补齐分支测试；
- [ ] **阶段 4（E2E 自动化）**：构建 Playwright 端到端浏览器测试流水线。
