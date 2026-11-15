# Base pi command: no auto-discovered extensions/skills (explicit -e paths still load)
pi := "pi --no-extensions --no-skills --model deepseek/deepseek-flash"

default:
    @just --list

# Pi Pi 中文版：TUI 与对话均为中文，带主题切换
pi-pi-cn:
    {{pi}} -e extensions/pi-pi-cn.ts -e extensions/theme-cycler.ts

# 猜数字：看清 Agent Loop 在哪循环、在哪 break（/guess 开局，/guess human 同学当裁判，/step 单步）
loop-demo:
    {{pi}} --no-builtin-tools --thinking off -e extensions/loop-demo.ts
