import json
import re
import os

path = r'C:\Users\user\.cursor\projects\c-Users-user-Desktop-BREM\agent-transcripts\19c3f8fe-ea1c-4e74-90cb-a80d463434a2\19c3f8fe-ea1c-4e74-90cb-a80d463434a2.jsonl'
out_dir = r'C:\Users\user\Desktop\BREM\_restore_tmp'
os.makedirs(out_dir, exist_ok=True)

ops = []
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
            if name == 'Write' and inp.get('path', '').endswith('admin.html'):
                ops.append((lineno, 'Write', inp.get('contents', '')))
            elif name == 'StrReplace' and inp.get('path', '').endswith('admin.html'):
                ops.append((lineno, 'StrReplace', inp.get('old_string', ''), inp.get('new_string', '')))
            elif name == 'ApplyPatch':
                patch = inp if isinstance(inp, str) else inp.get('input', '')
                if 'admin.html' in patch:
                    ops.append((lineno, 'ApplyPatch', patch))

print(f'Found {len(ops)} operations')
for op in ops:
    if op[1] == 'Write':
        print(f'  L{op[0]} Write lines={op[2].count(chr(10)) + 1} has_html={("</html>" in op[2])}')
    elif op[1] == 'StrReplace':
        print(f'  L{op[0]} StrReplace old={len(op[2])} new={len(op[3])}')
    else:
        print(f'  L{op[0]} ApplyPatch len={len(op[2])}')


def apply_patch(content, patch, lineno):
    if '*** Add File:' in patch and 'admin.html' in patch:
        lines = []
        in_file = False
        for pline in patch.splitlines():
            if pline.startswith('*** Add File:') and 'admin.html' in pline:
                in_file = True
                continue
            if in_file:
                if pline.startswith('***'):
                    break
                if pline.startswith('+'):
                    lines.append(pline[1:])
        return '\n'.join(lines)

    if '*** Update File:' in patch and 'admin.html' in patch:
        if content is None:
            return content
        for hunk in re.finditer(r'@@.*?@@\n(.*?)(?=\n@@|\n\*\*\* End Patch|\Z)', patch, re.DOTALL):
            hunk_text = hunk.group(1)
            old_lines, new_lines = [], []
            for pline in hunk_text.splitlines():
                if pline.startswith('-'):
                    old_lines.append(pline[1:])
                elif pline.startswith('+'):
                    new_lines.append(pline[1:])
                elif pline.startswith(' '):
                    old_lines.append(pline[1:])
                    new_lines.append(pline[1:])
            old = '\n'.join(old_lines)
            new = '\n'.join(new_lines)
            if old in content:
                content = content.replace(old, new, 1)
            else:
                print(f'  WARN L{lineno} hunk not found: {old[:100]!r}')
        return content
    return content


content = None
failed = 0
for op in ops:
    if op[1] == 'Write':
        content = op[2]
    elif op[1] == 'ApplyPatch':
        content = apply_patch(content, op[2], op[0])
    elif op[1] == 'StrReplace':
        old, new = op[2], op[3]
        if content is None:
            continue
        if old in content:
            content = content.replace(old, new, 1)
        else:
            failed += 1
            print(f'  WARN L{op[0]} StrReplace not found: {old[:100]!r}')

if content:
    out_path = os.path.join(out_dir, 'admin_reconstructed.html')
    with open(out_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)
    print(f'\nReconstructed: {content.count(chr(10)) + 1} lines -> {out_path}')
    print('Has </html>:', '</html>' in content)
    print('Failed replaces:', failed)
    scripts = re.findall(r'<script[^>]*src="([^"]+)"', content)
    print('Scripts:')
    for s in scripts:
        print(' ', s)
else:
    print('No content reconstructed')
