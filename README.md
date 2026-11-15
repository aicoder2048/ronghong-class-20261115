# ronghong-class-20261115

RongHong 课程材料。本节课用 Pi（coding agent）的扩展来看清 **Agent Loop**：循环在哪里转，又在哪里结束。

## 准备

- 装好 `pi` 和 `just`
- Pi 里能用 `deepseek/deepseek-flash`（两个 demo 都固定用它，按量计费）
- 所有命令都在项目根目录运行

```bash
just            # 列出所有命令
```

## Demo 1：猜数字，看清 Agent Loop

```bash
just loop-demo
```

进去之后输入命令开局：

| 命令 | 作用 |
| --- | --- |
| `/guess` | 开一局，电脑当裁判。秘密数字显示在面板上，大模型看不到 |
| `/guess human` | 开一局，同学当裁判。同学心里想一个 1–100 的数，每次选"太大了 / 太小了 / 猜对了" |
| `/step` | 开关单步模式：每次执行工具前暂停，确认后再继续 |

不输入命令、直接说"来猜数字吧"也能玩，电脑会自己想一个数。

### 面板怎么看

屏幕上会一直显示循环的伪代码，`▶` 指着现在跑到哪一行：

```
   while (true) {
       回复 = 调大模型(对话)
 ▶     if (回复里没有工具调用) break    ← 有 1 个工具调用 → 不 break，继续
       结果 = 执行工具(回复)
       对话.push(结果)
   }
   把回答交给用户
```

下面的"记录"一圈一行：

```
第5圈 🧠 → 🔧 guess_number(72) → 📨 太大了 → 🔁 再来一圈
第6圈 🧠 → 🔧 guess_number(70) → 📨 猜对了 → 🔁 再来一圈
第7圈 🧠 → 没有工具调用 → 🚪 break
✅ 循环结束：一共 7 圈，调了 7 次大模型
```

### 课上要讲的三件事

1. **一圈是什么**：调一次大模型 → 执行它要的工具 → 把结果放回对话。
2. **循环怎么结束**：每一圈都问同一个问题——这次回复里有没有工具调用？没有就 `break`。
3. **猜对了 ≠ 循环结束**：工具返回"猜对了"之后，还要再调一次大模型；它这次只说话、不再要工具，循环才结束。

### 可以和孩子玩的

- 开局前先猜：1 到 100，最多要几圈？（二分法最多 7 次猜中，加上最后 break 的一圈）
- 开 `/step`，每圈暂停时让孩子预测大模型下一个猜几
- `/guess human` 让一个孩子当"工具"：大模型只负责想，工具负责给结果
- 当裁判的孩子故意答错一次，看大模型会怎么样

### 代码在哪

`extensions/loop-demo.ts`，一个文件，分三块：

- `pi.registerTool(...)`：注册 `guess_number` 工具
- `pi.on("turn_start" | "message_end" | "tool_call" | "tool_result" | "turn_end" | "agent_end", ...)`：在循环的每个节点挂钩子，更新面板
- `pi.registerCommand(...)`：`/guess` 和 `/step`

面板上的 `if (...) break` 是为了好讲。Pi 的真实源码写的是 `while (hasMoreToolCalls)`，用一个标记变量控制，意思相同。

## Demo 2：Pi Pi 中文版

```bash
just pi-pi-cn
```

一个帮你造 Pi 扩展的"元智能体"：主智能体通过 `query_experts` 工具并行询问 9 个专家（扩展、主题、技能、TUI 等），再动手写代码。界面和对话都是中文。

- `/experts`：列出专家
- `/experts-grid`：调整专家面板的列数
- 换主题：`Ctrl+X` 下一个，`Ctrl+Q` 上一个，`/theme` 打开选择列表

进阶看点：`query_experts` 这个工具里，每个专家都是一个独立的 `pi` 进程，各自跑着自己的 Agent Loop。

## 目录

```
extensions/
  loop-demo.ts       猜数字 + 循环追踪
  pi-pi-cn.ts        Pi Pi 中文版
  theme-cycler.ts    主题切换
  themeMap.ts        扩展和主题的对应表
.pi/
  agents/pi-pi/      主智能体提示词 + 9 个专家定义
  agents/pi-pi-cn/   中文语言规则
  themes/            11 个主题
justfile             启动命令
```

`pi-pi-cn` 相关文件（扩展、专家定义、主题）拷自 pi-vs-claude-code 仓库。
