import json

path = r'C:\Users\user\.cursor\projects\c-Users-user-Desktop-BREM\agent-transcripts\19c3f8fe-ea1c-4e74-90cb-a80d463434a2\19c3f8fe-ea1c-4e74-90cb-a80d463434a2.jsonl'
misses = []
with open(path, encoding='utf-8') as f:
    content = open(r'C:\Users\user\Desktop\BREM\_restore_tmp\admin_reconstructed.html', encoding='utf-8').read()
    for i, line in enumerate(f, 1):
        obj = json.loads(line)
        for part in obj.get('message', {}).get('content', []):
            if part.get('name') != 'StrReplace':
                continue
            inp = part.get('input', {})
            if not str(inp.get('path','')).endswith('admin.html'):
                continue
            old = inp.get('old_string','')
            new = inp.get('new_string','')
            if old and old not in content and len(old) > 100:
                misses.append((i, len(old), len(new), old[:100]))

print(f'{len(misses)} missed patches')
for m in misses:
    print(f'L{m[0]} old={m[1]} new={m[2]} | {m[3]!r}')
