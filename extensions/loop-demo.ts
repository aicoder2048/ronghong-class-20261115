/**
 * Loop Demo —— 用"猜数字"游戏看清 Agent Loop
 *
 * 课堂要讲的两件事：
 *   1. 循环在哪：每一圈 = 调一次大模型 → 执行它要的工具 → 把结果放回对话
 *   2. 循环怎么结束：大模型的回复里【没有工具调用】时 break
 *      （注意：工具返回"猜对了"并不会结束循环，还要再回到大模型一次）
 *
 * 这个扩展做了三件事：
 *   - 注册工具 guess_number：秘密数字藏在扩展里，大模型只能靠工具结果来猜
 *   - 挂钩子追踪循环：turn_start / message_end / tool_call / tool_result / turn_end / agent_end
 *   - 在屏幕上画出循环的伪代码，用 ▶ 指出"现在跑到哪一行"
 *
 * 命令：
 *   /guess         开一局，电脑当裁判（秘密数字显示在面板上，大模型看不到）
 *   /guess human   开一局，同学当裁判（同学心里想一个数，亲自扮演"工具"）
 *   /step          开关单步模式：每次执行工具前暂停，等老师按回车
 *
 * 说明：Pi 真实源码（pi-agent-core 的 agent-loop.js）里写的是
 *   while (hasMoreToolCalls) { ... hasMoreToolCalls = 这一圈有没有工具调用 }
 * 和面板上的 `if (没有工具调用) break` 是同一个意思，后者更适合讲给孩子听。
 *
 * 用法：just loop-demo
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ── 游戏规则（纯函数，和 Pi 无关）────────────────

const MIN = 1;
const MAX = 100;

type Verdict = "太大了" | "太小了" | "猜对了";
const VERDICTS: Verdict[] = ["太大了", "太小了", "猜对了"];

function judge(secret: number, guess: number): Verdict {
	if (guess > secret) return "太大了";
	if (guess < secret) return "太小了";
	return "猜对了";
}

function pickSecret(): number {
	return MIN + Math.floor(Math.random() * (MAX - MIN + 1));
}

// ── 循环的伪代码：面板上逐行显示，▶ 指向当前行 ──

type Line = "while" | "llm" | "check" | "tool" | "push" | "done";

const CODE: { id: Line; text: string }[] = [
	{ id: "while", text: "while (true) {" },
	{ id: "llm",   text: "    回复 = 调大模型(对话)" },
	{ id: "check", text: "    if (回复里没有工具调用) break" },
	{ id: "tool",  text: "    结果 = 执行工具(回复)" },
	{ id: "push",  text: "    对话.push(结果)" },
	{ id: "while", text: "}" },
	{ id: "done",  text: "把回答交给用户" },
];

const LOG_LINES = 8;

/** 把工具参数写成 guess_number(50) 这种样子；多个参数时写成 a=1, b=2 */
function formatArgs(input: unknown): string {
	const entries = Object.entries((input ?? {}) as Record<string, unknown>);
	if (entries.length === 1) return String(entries[0][1]);
	return entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");
}

export default function (pi: ExtensionAPI) {
	// ── 状态 ──────────────────────────────────────
	let secret: number | null = null;   // null = 还没开局
	let humanJudge = false;             // true = 同学当裁判
	let stepMode = false;               // true = 每次执行工具前暂停

	let round = 0;                      // 第几圈
	let current: Line = "done";         // ▶ 指向哪一行
	let note = "输入 /guess 开一局";     // 当前行旁边的说明
	let log: string[] = [];             // 每一圈的记录
	let roundLog = "";                  // 正在进行的这一圈

	let uiCtx: ExtensionContext | undefined;

	// ── 显示 ──────────────────────────────────────

	function record(line: string) {
		log.push(line);
		// 没有界面时（pi -p）打到 stderr，方便检查
		if (!uiCtx?.hasUI) console.error(`[loop-demo] ${line}`);
	}

	function render() {
		if (!uiCtx?.hasUI) return;
		uiCtx.ui.setWidget("loop-demo", (_tui: any, theme: any) => ({
			render(width: number): string[] {
				const modes = [
					humanJudge ? "同学当裁判" : "电脑当裁判",
					stepMode ? "单步" : "自动",
				].join(" · ");
				const secretText = secret === null
					? ""
					: humanJudge
						? "  秘密数字：在同学心里"
						: `  秘密数字：${secret}（大模型看不到）`;

				const lines: string[] = [
					theme.fg("accent", ` Agent Loop · 第 ${round} 圈`) +
						theme.fg("dim", `  [${modes}]${secretText}`),
				];

				// 伪代码："}" 和 "while" 共用一个 id，只在 while 行画 ▶
				let pointerDrawn = false;
				for (const row of CODE) {
					const isCurrent = row.id === current && !pointerDrawn;
					if (isCurrent) {
						pointerDrawn = true;
						lines.push(
							theme.fg("accent", ` ▶ ${row.text}`) +
								theme.fg("warning", note ? `   ← ${note}` : ""),
						);
					} else {
						lines.push(theme.fg("dim", `   ${row.text}`));
					}
				}

				lines.push(theme.fg("borderMuted", " ── 记录 ──"));
				const shown = [...log, ...(roundLog ? [roundLog] : [])].slice(-LOG_LINES);
				for (const entry of shown) lines.push(theme.fg("muted", ` ${entry}`));

				return lines.map(l => truncateToWidth(l, width));
			},
			invalidate() {},
		}));
	}

	function moveTo(line: Line, text: string) {
		current = line;
		note = text;
		render();
	}

	// ── 工具：guess_number ────────────────────────
	// 大模型只会"提出"调用；真正执行的是下面这个 execute。

	pi.registerTool({
		name: "guess_number",
		label: "猜数字",
		description:
			`猜一次秘密数字（${MIN} 到 ${MAX} 之间的整数）。` +
			`返回"太大了"、"太小了"或"猜对了"。每次只猜一个数。`,
		parameters: Type.Object({
			n: Type.Integer({ minimum: MIN, maximum: MAX, description: "你猜的数" }),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { n } = params as { n: number };

			let verdict: Verdict;
			if (humanJudge) {
				// 同学就是"工具"：大模型提出请求，人来给结果
				const choice = await ctx.ui.select(`AI 猜的是 ${n}，你心里的数是？`, VERDICTS);
				if (!choice) throw new Error("裁判没有回答，这次猜测作废");
				verdict = choice as Verdict;
			} else {
				// 没用 /guess、直接说"来猜数字"也能玩：第一次猜的时候现想一个
				if (secret === null) secret = pickSecret();
				verdict = judge(secret, n);
				render();
			}

			return {
				content: [{ type: "text", text: verdict }],
				details: { n, verdict },
			};
		},
	});

	// ── 钩子：循环的每个节点 ──────────────────────

	// 一次 agent 运行开始（用户发来一条消息）
	pi.on("agent_start", async (_event, ctx) => {
		uiCtx = ctx;
		round = 0;
		log = [];
		roundLog = "";
		moveTo("while", "进入循环");
	});

	// 新的一圈开始：马上要调大模型
	pi.on("turn_start", async (_event, ctx) => {
		uiCtx = ctx;
		round++;
		roundLog = `第${round}圈 🧠 调大模型…`;
		moveTo("llm", "🧠 大模型在想");
	});

	// 大模型回复完了：这里就是"要不要跳出循环"的判断点
	pi.on("message_end", async (event, _ctx) => {
		const message = event.message as any;
		if (message.role !== "assistant") return;

		const calls = (message.content as any[]).filter(c => c.type === "toolCall");
		if (calls.length > 0) {
			roundLog = `第${round}圈 🧠 → 要调 ${calls.length} 个工具`;
			moveTo("check", `有 ${calls.length} 个工具调用 → 不 break，继续`);
		} else {
			roundLog = "";
			record(`第${round}圈 🧠 → 没有工具调用 → 🚪 break`);
			moveTo("check", "没有工具调用 → 🚪 break！跳出循环");
		}
	});

	// 工具执行之前（可以拦截；单步模式在这里暂停）
	pi.on("tool_call", async (event, ctx) => {
		const args = formatArgs(event.input);
		if (stepMode && ctx.hasUI) {
			const choice = await ctx.ui.select(
				`第 ${round} 圈：大模型要调 ${event.toolName}(${args})`,
				["继续 ▶", "关掉单步，一路跑完"],
			);
			if (choice !== "继续 ▶") stepMode = false;
		}
		roundLog = `第${round}圈 🧠 → 🔧 ${event.toolName}(${args})`;
		moveTo("tool", `🔧 ${event.toolName}(${args})`);
	});

	// 工具执行之后：结果要放回对话
	pi.on("tool_result", async (event, _ctx) => {
		const text = (event.content as any[])
			.filter(c => c.type === "text")
			.map(c => c.text)
			.join(" ")
			.slice(0, 40);
		roundLog += ` → 📨 ${text}`;
		const stillLooping = text === "猜对了" ? "（猜对了，但循环还没结束！）" : "";
		moveTo("push", `📨 "${text}" 放回对话${stillLooping}`);
	});

	// 这一圈结束：有工具结果就回到循环开头
	pi.on("turn_end", async (event, _ctx) => {
		if (event.toolResults.length === 0) return; // break 那一圈已在 message_end 记过
		record(`${roundLog} → 🔁 再来一圈`);
		roundLog = "";
		moveTo("while", "🔁 回到循环开头");
	});

	// 循环真的结束了
	pi.on("agent_end", async (_event, _ctx) => {
		record(`✅ 循环结束：一共 ${round} 圈，调了 ${round} 次大模型`);
		moveTo("done", `循环结束，共 ${round} 圈`);
	});

	// ── 提示词：只加游戏规则，不改 Pi 自带的提示词 ──

	pi.on("before_agent_start", async (event, _ctx) => {
		return {
			systemPrompt:
				event.systemPrompt +
				"\n\n## 猜数字游戏规则\n" +
				"- 用中文回答，对象是小学生，句子要短。\n" +
				"- 只能用 guess_number 工具来猜，每次回复只猜一个数，不许自己编结果。\n" +
				"- 工具返回「猜对了」之后，用一句话宣布答案和一共猜了几次，然后停下，不要再调用工具。",
		};
	});

	// ── 命令 ──────────────────────────────────────

	pi.registerCommand("guess", {
		description: "开一局猜数字。/guess = 电脑当裁判，/guess human = 同学当裁判",
		handler: async (args, ctx) => {
			uiCtx = ctx;
			if (!ctx.isIdle()) {
				ctx.ui.notify("上一局还没跑完，等它结束再开新的", "warning");
				return;
			}
			const mode = (args ?? "").trim();
			if (mode !== "" && mode !== "human") {
				ctx.ui.notify(`不认识的参数 "${mode}"，只能是空或 human`, "error");
				return;
			}
			humanJudge = mode === "human";
			secret = humanJudge ? -1 : pickSecret(); // -1 只表示"已开局"，同学当裁判时不用它
			pi.sendUserMessage(
				`我想好了一个 ${MIN} 到 ${MAX} 之间的整数，请你用 guess_number 工具把它猜出来。`,
			);
		},
	});

	pi.registerCommand("step", {
		description: "开关单步模式：每次执行工具前暂停",
		handler: async (_args, ctx) => {
			uiCtx = ctx;
			stepMode = !stepMode;
			ctx.ui.notify(`单步模式：${stepMode ? "开" : "关"}`, "info");
			render();
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		uiCtx = ctx;
		render();
	});
}
