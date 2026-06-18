import json

path = r'C:\Users\user\.cursor\projects\c-Users-user-Desktop-BREM\agent-transcripts\19c3f8fe-ea1c-4e74-90cb-a80d463434a2\19c3f8fe-ea1c-4e74-90cb-a80d463434a2.jsonl'
out_dir = r'C:\Users\user\Desktop\BREM\_restore_tmp\chunks'

import os
os.makedirs(out_dir, exist_ok=True)

chunks = []
with open(path, 'r', encoding='utf-8') as f:
    for lineno, line in enumerate(f, 1):
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = obj.get('message', {})
        for part in msg.get('content', []):
            if part.get('type') != 'tool_use':
                continue
            if part.get('name') != 'StrReplace':
                continue
            inp = part.get('input', {})
            if not str(inp.get('path', '')).endswith('admin.html'):
                continue
            ns = inp.get('new_string', '')
            if len(ns) > 500:
                chunks.append((lineno, len(ns), ns))

chunks.sort(key=lambda x: x[1], reverse=True)
print(f'Large chunks: {len(chunks)}')
for i, (lineno, size, text) in enumerate(chunks[:20]):
    fname = os.path.join(out_dir, f'chunk_L{lineno}_{size}.html')
    with open(fname, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    preview = text[:120].replace('\n', ' ')
    print(f'  L{lineno} size={size} preview={preview!r} -> {fname}')
