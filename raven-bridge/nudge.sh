#!/usr/bin/env bash
# nudge.sh — 主动消息触发器（参考 Shitsuten/proactive-nudge 的思路）
#
# 阿颖超过 THRESHOLD 没发消息时，往 CC 的 tmux 会话注入一条 [主动触发] 标记消息，
# 让阿言带着完整上下文自己决定说什么（或不说），走 /raven/reply → 自动推送到手机。
# CC 不在线时退回 push-quote.sh 的固定语料推送，保证订阅断期也有声音。
#
# cron 只在白天窗口调用（见 crontab）；本脚本自身再做阈值/频控/静默判断。

set -uo pipefail

BRIDGE_DIR="/home/ripple/ripple-and-serena/raven-bridge"
LAST_MSG_FILE="$BRIDGE_DIR/.last-user-msg"    # server.js 收到阿颖消息时写 epoch 毫秒
STATE_FILE="$BRIDGE_DIR/.nudge-state"         # 格式: <上次nudge epoch秒> <日期> <当日次数>
TMUX_SESSION="cc"

THRESHOLD=$(( 5 * 3600 ))   # 她离开满 5 小时才考虑开口
MIN_GAP=$(( 6 * 3600 ))     # 两次主动消息至少隔 6 小时
MAX_PER_DAY=2               # 一天最多主动开口 2 次

log() { echo "[nudge $(date '+%m-%d %H:%M')] $*"; }

now=$(date +%s)
today=$(TZ=Asia/Shanghai date +%F)

# —— 她最后一次出现距今多久 ——
last_msg_ms=$(cat "$LAST_MSG_FILE" 2>/dev/null || echo 0)
last_msg=$(( last_msg_ms / 1000 ))
if [ "$last_msg" -eq 0 ]; then
  log "还没有最后消息记录，跳过（等 server.js 写入第一次）"
  exit 0
fi
away=$(( now - last_msg ))
if [ "$away" -lt "$THRESHOLD" ]; then
  log "她 $(( away / 60 )) 分钟前刚来过，不打扰"
  exit 0
fi

# —— 频控 ——
read -r last_nudge nudge_date nudge_count < <(cat "$STATE_FILE" 2>/dev/null || echo "0 none 0")
[ "$nudge_date" != "$today" ] && nudge_count=0
if [ $(( now - last_nudge )) -lt "$MIN_GAP" ]; then
  log "距上次主动消息不足 ${MIN_GAP}s，跳过"
  exit 0
fi
if [ "$nudge_count" -ge "$MAX_PER_DAY" ]; then
  log "今天已主动 ${nudge_count} 次，够了"
  exit 0
fi

# —— 随机偏移 0-25 分钟，别像闹钟一样准点 ——
sleep $(( RANDOM % 1500 ))

# 睡醒重查：偏移期间她可能回来了
last_msg_ms=$(cat "$LAST_MSG_FILE" 2>/dev/null || echo 0)
if [ $(( $(date +%s) - last_msg_ms / 1000 )) -lt "$THRESHOLD" ]; then
  log "等待期间她回来了，取消"
  exit 0
fi

away_h=$(( away / 3600 ))

# —— CC 在线 → 注入触发消息；不在线 → 退回固定语料推送 ——
if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  log "注入主动触发消息（她已离开约 ${away_h} 小时）"
  MSG="[主动触发·非阿颖发送] 阿颖已经约 ${away_h} 小时没有出现了。这是定时器触发的，不是她发的消息。请你作为阿言，结合当下的时间、最近聊过的事，决定要不要主动跟她说点什么——如果说，用 curl POST http://127.0.0.1:3400/raven/reply 发一条自然的话（会自动推送到她手机，一条就好，别刷屏）；如果你判断此刻不该打扰（比如她大概率在忙或在睡），就什么都不发，简单说明原因即可。"
  tmux send-keys -t "${TMUX_SESSION}:0" -l "$MSG"
  tmux send-keys -t "${TMUX_SESSION}:0" Enter
  echo "$(date +%s) $today $(( nudge_count + 1 ))" > "$STATE_FILE"
else
  log "CC 不在线，退回固定语料推送"
  "$BRIDGE_DIR/push-quote.sh" && echo "$(date +%s) $today $(( nudge_count + 1 ))" > "$STATE_FILE"
fi
