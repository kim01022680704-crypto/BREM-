import json
import re

path = r'C:\Users\user\.cursor\projects\c-Users-user-Desktop-BREM\agent-transcripts\19c3f8fe-ea1c-4e74-90cb-a80d463434a2\19c3f8fe-ea1c-4e74-90cb-a80d463434a2.jsonl'
out_path = r'C:\Users\user\Desktop\BREM\_restore_tmp\admin_reconstructed.html'

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
            if name == 'Write' and str(inp.get('path', '')).endswith('admin.html'):
                ops.append((lineno, 'Write', inp.get('contents', '')))
            elif name == 'StrReplace' and str(inp.get('path', '')).endswith('admin.html'):
                ops.append((lineno, 'StrReplace', inp.get('old_string', ''), inp.get('new_string', '')))
            elif name == 'ApplyPatch':
                patch = inp if isinstance(inp, str) else inp.get('input', '')
                if 'admin.html' in patch:
                    ops.append((lineno, 'ApplyPatch', patch))


def parse_add_file(patch):
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


def apply_update_patch(content, patch, lineno):
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
            print(f'  WARN L{lineno} hunk miss: {old[:80]!r}')
    return content


content = None
ok = fail = 0
for op in ops:
    kind = op[1]
    if kind == 'Write':
        content = op[2]
        ok += 1
    elif kind == 'ApplyPatch':
        patch = op[2]
        if '*** Add File:' in patch and 'admin.html' in patch:
            content = parse_add_file(patch)
            ok += 1
        elif '*** Update File:' in patch and 'admin.html' in patch:
            before = content
            content = apply_update_patch(content, patch, op[0])
            if content != before:
                ok += 1
            else:
                fail += 1
    elif kind == 'StrReplace':
        old, new = op[2], op[3]
        if content is None:
            continue
        if old in content:
            content = content.replace(old, new, 1)
            ok += 1
        else:
            fail += 1

print(f'Applied {ok} ok, {fail} failed')
if content:
    with open(out_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)
    print(f'Lines: {content.count(chr(10)) + 1}')
    print('Has </html>:', '</html>' in content)
    print('Has login page:', 'adminLoginPage' in content)
    print('Sections:', re.findall(r'id="([^"]+)" class="section"', content))
    print('Nav sections:', re.findall(r'data-section="([^"]+)"', content))
    scripts = re.findall(r'<script[^>]*src="([^"]+)"', content)
    print('Scripts:')
    for s in scripts:
        print(' ', s)
