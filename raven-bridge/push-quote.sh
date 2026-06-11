#!/usr/bin/env bash
# 随机抽取推送语料（记忆ID 256），发送一条推送给阿颖
# 由 cron 调用，三个时间窗口各带随机 sleep 偏移

set -euo pipefail

# 从 moon-memory .env 读取 token
ENV_FILE="/home/ripple/moon-memory/.env"
MOON_TOKEN=$(grep '^MOON_API_TOKEN=' "$ENV_FILE" | cut -d= -f2)

if [ -z "$MOON_TOKEN" ]; then
  echo "[push-quote] 找不到 MOON_API_TOKEN" >&2
  exit 1
fi

# 随机 sleep 0-90 分钟（让实际发送时间在窗口内随机分布）
OFFSET_MIN=$(( RANDOM % 91 ))
if [ "$OFFSET_MIN" -gt 0 ]; then
  echo "[push-quote] 等待 ${OFFSET_MIN} 分钟后发送..."
  sleep $(( OFFSET_MIN * 60 ))
fi

# 获取记忆 256 的内容
MEM_CONTENT=$(curl -sf \
  -H "Authorization: Bearer ${MOON_TOKEN}" \
  "http://127.0.0.1:3210/memories/256" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('content',''))" 2>/dev/null)

if [ -z "$MEM_CONTENT" ]; then
  echo "[push-quote] 读取记忆 256 失败" >&2
  exit 1
fi

# 过滤掉空行、标题行（以【开头或以：结尾的行），提取纯引言
QUOTES=$(echo "$MEM_CONTENT" | grep -v '^$' | grep -v '^【' | grep -v '：$' | grep -v '^---' | grep -v '^#' | grep -v '^\s*$')

if [ -z "$QUOTES" ]; then
  echo "[push-quote] 没有可用语料" >&2
  exit 1
fi

# 随机取一行（避开上一次发过的，连发不重复）
STATE_FILE="/home/ripple/ripple-and-serena/raven-bridge/.push-quote-last"
LAST=$(cat "$STATE_FILE" 2>/dev/null || true)
QUOTE=$( { echo "$QUOTES" | grep -vxF "$LAST" || echo "$QUOTES"; } | shuf -n 1)
echo "$QUOTE" > "$STATE_FILE"

echo "[push-quote] 发送：$QUOTE"

# 发送推送
RESULT=$(curl -sf -X POST \
  -H "Authorization: Bearer ${MOON_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"阿言想你了\",\"body\":$(python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))" <<< "$QUOTE")}" \
  "http://127.0.0.1:3210/push/send-fixed")

echo "[push-quote] 结果：$RESULT"
