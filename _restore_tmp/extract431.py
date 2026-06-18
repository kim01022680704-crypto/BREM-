import json

path = r'C:\Users\user\.cursor\projects\c-Users-user-Desktop-BREM\agent-transcripts\19c3f8fe-ea1c-4e74-90cb-a80d463434a2\19c3f8fe-ea1c-4e74-90cb-a80d463434a2.jsonl'
with open(path, encoding='utf-8') as f:
    for i, line in enumerate(f, 1):
        if i != 431:
            continue
        obj = json.loads(line)
        for part in obj['message']['content']:
            if part.get('name') == 'StrReplace' and part['input'].get('path','').endswith('admin.html'):
                ns = part['input']['new_string']
                if 'eventItemList' in ns:
                    print(ns)
