#!/usr/bin/env python3
import json, sys, urllib.request, urllib.error

BRIDGE = 'http://127.0.0.1:3400/raven/thinking'

def main():
    try:
        hook_data = json.loads(sys.stdin.read())
    except Exception:
        return

    transcript = hook_data.get('transcript_path') or hook_data.get('transcriptPath')
    if not transcript:
        return

    try:
        with open(transcript, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except Exception:
        return

    # find the last assistant message with a non-empty thinking block
    for line in reversed(lines):
        try:
            entry = json.loads(line)
            msg = entry.get('message', {})
            if msg.get('role') != 'assistant':
                continue
            for block in msg.get('content', []):
                if block.get('type') == 'thinking' and block.get('thinking', '').strip():
                    payload = json.dumps({'thinking': block['thinking']}).encode()
                    req = urllib.request.Request(
                        BRIDGE, data=payload,
                        headers={'Content-Type': 'application/json'},
                        method='POST'
                    )
                    urllib.request.urlopen(req, timeout=3)
                    return
        except Exception:
            continue

if __name__ == '__main__':
    main()
