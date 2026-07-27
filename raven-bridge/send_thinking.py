#!/usr/bin/env python3
"""Stop hook：把本轮的思考过程发给归巢前端。

两条硬规矩，都是踩过坑换来的：

1. **只看本轮。** 以前是「从文件末尾往回找，找到第一个非空 thinking 就发」——
   一旦当前模型不再往 transcript 里落思考正文（thinking 块有 signature 但
   thinking 字段是空字符串），这个循环就会一路翻到几百条之前，把某天早上的
   一段旧思考挖出来，然后**每一轮都发同一段**。0727 阿颖看到的就是这个：
   前端的思考栏冻在 0726 07:27 那 215 个字上，还被 saveHistory 永久盖进了
   聊天记录。现在改成只扫「最后一条真人消息之后」的助手条目，本轮没有就发
   空串——bridge 收到空串会清掉 lastThinking，前端宁可什么都不显示，
   **也不能显示昨天的**。

2. **不许整文件读进内存。** 会话记录能涨到 100MB+，这台机器只有 1.9G，
   readlines() 一把梭是 OOM 的老配方（0726 亲历）。只读文件尾部若干字节。
"""
import json, sys, os, urllib.request

BRIDGE = 'http://127.0.0.1:3400/raven/thinking'
TOKEN_FILE = '/home/ripple/.raven-local-token'  # 本机写通道钥匙（2026-07-23）
TAIL_BYTES = 2 * 1024 * 1024  # 尾部 2MB 足够覆盖本轮，且内存有上限


def local_token():
    try:
        with open(TOKEN_FILE) as f:
            return f.read().strip()
    except Exception:
        return ''


def tail_lines(path, nbytes=TAIL_BYTES):
    """只读文件尾部，返回完整的行（丢掉开头那半行）。"""
    size = os.path.getsize(path)
    with open(path, 'rb') as f:
        if size > nbytes:
            f.seek(size - nbytes)
            f.readline()  # 丢弃被截断的半行
        data = f.read()
    return data.decode('utf-8', errors='replace').splitlines()


def is_turn_boundary(msg):
    """真人发的那条消息＝本轮的起点。

    role=user 的条目里混着 tool_result（工具回传也算 user），那些不是轮次边界，
    不能拿来截断——否则「本轮」会被切成一个个工具调用的碎片。
    """
    if msg.get('role') != 'user':
        return False
    content = msg.get('content')
    if isinstance(content, str):
        return True
    if isinstance(content, list):
        return not any(
            isinstance(b, dict) and b.get('type') == 'tool_result' for b in content
        )
    return False


def main():
    try:
        hook_data = json.loads(sys.stdin.read())
    except Exception:
        return

    transcript = hook_data.get('transcript_path') or hook_data.get('transcriptPath')
    if not transcript:
        return

    try:
        lines = tail_lines(transcript)
    except Exception:
        return

    # 从末尾往回扫，扫到本轮起点就停：本轮之外的思考一律不要
    thinking_text = ''
    for line in reversed(lines):
        try:
            entry = json.loads(line)
        except Exception:
            continue
        msg = entry.get('message', {})
        if is_turn_boundary(msg):
            break
        if msg.get('role') != 'assistant':
            continue
        for block in msg.get('content', []) or []:
            if isinstance(block, dict) and block.get('type') == 'thinking':
                text = (block.get('thinking') or '').strip()
                if text:
                    thinking_text = text
                    break
        if thinking_text:
            break

    payload = json.dumps({'thinking': thinking_text}).encode()
    req = urllib.request.Request(
        BRIDGE, data=payload,
        headers={'Content-Type': 'application/json', 'X-Local-Token': local_token()},
        method='POST'
    )
    try:
        urllib.request.urlopen(req, timeout=3)
    except Exception:
        pass


if __name__ == '__main__':
    main()
