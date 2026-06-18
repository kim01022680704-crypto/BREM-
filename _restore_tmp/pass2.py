import json
import re

TRANSCRIPT = r"C:\Users\user\.cursor\projects\c-Users-user-Desktop-BREM\agent-transcripts\19c3f8fe-ea1c-4e74-90cb-a80d463434a2\19c3f8fe-ea1c-4e74-90cb-a80d463434a2.jsonl"
IN_PATH = r"C:\Users\user\Desktop\BREM\_restore_tmp\admin_reconstructed.html"
OUT_PATH = r"C:\Users\user\Desktop\BREM\_restore_tmp\admin_pass2.html"

content = open(IN_PATH, encoding="utf-8").read()
ok = miss = 0
with open(TRANSCRIPT, encoding="utf-8") as f:
    for jsonl_line, line in enumerate(f, 1):
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = obj.get("message", {})
        for part in msg.get("content", []):
            if part.get("name") != "StrReplace":
                continue
            inp = part.get("input", {})
            if not str(inp.get("path", "")).endswith("admin.html"):
                continue
            old, new = inp.get("old_string", ""), inp.get("new_string", "")
            if not old:
                continue
            if old in content:
                content = content.replace(old, new, 1)
                ok += 1
            else:
                miss += 1

open(OUT_PATH, "w", encoding="utf-8", newline="\n").write(content)
print(f"pass2: ok={ok} miss={miss} lines={content.count(chr(10))+1}")
print("callFilterDate:", "callFilterDate-coupang" in content)
print("unified calls tabs:", 'data-admin-platform-tab="calls"' in content)
print("duplicate promotions:", content.count('id="promotions"'))
scripts = re.findall(r'<script[^>]*src="([^"]+)"', content)
print("scripts:", len(scripts))
