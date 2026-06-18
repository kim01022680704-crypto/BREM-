import json

path = r'C:\Users\user\.cursor\projects\c-Users-user-Desktop-BREM\agent-transcripts\19c3f8fe-ea1c-4e74-90cb-a80d463434a2\19c3f8fe-ea1c-4e74-90cb-a80d463434a2.jsonl'
out = r'C:\Users\user\Desktop\BREM\_restore_tmp'

with open(path, 'r', encoding='utf-8') as f:
    for lineno, line in enumerate(f, 1):
        if lineno not in (1660, 1562, 1634, 1495, 1512, 1425, 1461):
            continue
        obj = json.loads(line)
        for part in obj['message']['content']:
            if part.get('name') == 'StrReplace' and part.get('input', {}).get('path', '').endswith('admin.html'):
                inp = part['input']
                for label, key in [('OLD', 'old_string'), ('NEW', 'new_string')]:
                    text = inp.get(key, '')
                    fname = f'{out}/L{lineno}_{label}.html'
                    with open(fname, 'w', encoding='utf-8', newline='\n') as fo:
                        fo.write(text)
                    print(f'L{lineno} {label}: {len(text)} chars, {text.count(chr(10))+1} lines -> {fname}')
