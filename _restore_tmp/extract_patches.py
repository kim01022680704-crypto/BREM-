import json, re, os

path = r'C:\Users\user\.cursor\projects\c-Users-user-Desktop-BREM\agent-transcripts\19c3f8fe-ea1c-4e74-90cb-a80d463434a2\19c3f8fe-ea1c-4e74-90cb-a80d463434a2.jsonl'
out = r'C:\Users\user\Desktop\BREM\_restore_tmp\patches'
os.makedirs(out, exist_ok=True)

targets = {1182, 1191, 1264, 1461, 1512, 1562, 1594, 1634, 1660, 1669, 1495}
with open(path, 'r', encoding='utf-8') as f:
    for lineno, line in enumerate(f, 1):
        if lineno not in targets:
            continue
        obj = json.loads(line)
        for part in obj['message']['content']:
            if part.get('name') != 'StrReplace':
                continue
            inp = part.get('input', {})
            if not str(inp.get('path', '')).endswith('admin.html'):
                continue
            for label, key in [('OLD', 'old_string'), ('NEW', 'new_string')]:
                text = inp.get(key, '')
                if len(text) < 20:
                    continue
                fname = os.path.join(out, f'L{lineno}_{label}_{len(text)}.html')
                with open(fname, 'w', encoding='utf-8', newline='\n') as fo:
                    fo.write(text)
                print(fname, text.count('\n')+1, 'lines')
