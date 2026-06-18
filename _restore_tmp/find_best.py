import json
import re

path = r'C:\Users\user\.cursor\projects\c-Users-user-Desktop-BREM\agent-transcripts\19c3f8fe-ea1c-4e74-90cb-a80d463434a2\19c3f8fe-ea1c-4e74-90cb-a80d463434a2.jsonl'

candidates = []

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
            name = part.get('name')
            inp = part.get('input', {})
            texts = []
            if name == 'Write' and str(inp.get('path', '')).endswith('admin.html'):
                texts.append(('Write', inp.get('contents', '')))
            elif name == 'StrReplace' and str(inp.get('path', '')).endswith('admin.html'):
                texts.append(('StrReplace-new', inp.get('new_string', '')))
                texts.append(('StrReplace-old', inp.get('old_string', '')))
            elif name == 'ApplyPatch':
                patch = inp if isinstance(inp, str) else inp.get('input', '')
                if 'admin.html' in patch:
                    texts.append(('ApplyPatch', patch))
            for kind, text in texts:
                if not text:
                    continue
                if '</html>' in text or (kind == 'ApplyPatch' and '*** Add File:' in text and 'admin.html' in text):
                    candidates.append((lineno, kind, len(text), text.count('\n') + 1, text))

candidates.sort(key=lambda x: x[2], reverse=True)
print(f'Found {len(candidates)} candidates with </html> or Add File')
for c in candidates[:15]:
    print(f'  L{c[0]} {c[1]} chars={c[2]} lines={c[3]} has_doctype={"<!DOCTYPE" in c[4]}')

if candidates:
    best = candidates[0]
    out = r'C:\Users\user\Desktop\BREM\_restore_tmp\best_candidate.txt'
    text = best[4]
    if best[1] == 'ApplyPatch' and '*** Add File:' in text:
        lines = []
        in_file = False
        for pline in text.splitlines():
            if pline.startswith('*** Add File:') and 'admin.html' in pline:
                in_file = True
                continue
            if in_file:
                if pline.startswith('***'):
                    break
                if pline.startswith('+'):
                    lines.append(pline[1:])
        text = '\n'.join(lines)
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    print(f'\nSaved best to {out}')
    scripts = re.findall(r'<script[^>]*src="([^"]+)"', text)
    print('Scripts:', scripts)
