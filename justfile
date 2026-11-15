# Base pi command: no auto-discovered extensions/skills (explicit -e paths still load)
pi := "pi --no-extensions --no-skills --model deepseek/deepseek-flash"

default:
    @just --list

# Pi Pi 中文版：TUI 与对话均为中文，带主题切换
pi-pi-cn:
    {{pi}} -e extensions/pi-pi-cn.ts -e extensions/theme-cycler.ts
