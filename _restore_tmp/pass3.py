import json

TRANSCRIPT = r"C:\Users\user\.cursor\projects\c-Users-user-Desktop-BREM\agent-transcripts\19c3f8fe-ea1c-4e74-90cb-a80d463434a2\19c3f8fe-ea1c-4e74-90cb-a80d463434a2.jsonl"
content = open(r"C:\Users\user\Desktop\BREM\_restore_tmp\admin_pass2.html", encoding="utf-8").read()

for round_num in range(5):
    ok = 0
    with open(TRANSCRIPT, encoding="utf-8") as f:
        for line in f:
            obj = json.loads(line)
            for part in obj.get("message", {}).get("content", []):
                if part.get("name") != "StrReplace":
                    continue
                inp = part.get("input", {})
                if not str(inp.get("path", "")).endswith("admin.html"):
                    continue
                old, new = inp.get("old_string", ""), inp.get("new_string", "")
                if old and old in content:
                    content = content.replace(old, new, 1)
                    ok += 1
    print(f"round {round_num+1}: applied {ok}")

open(r"C:\Users\user\Desktop\BREM\_restore_tmp\admin_pass3.html", "w", encoding="utf-8", newline="\n").write(content)
print("lines:", content.count("\n")+1)
checks = ['callFilterDate-coupang', 'data-admin-platform-tab="calls"', 'adminLoginPage', 'adminApp', 'eventItemList', 'statWeekCallsCoupang']
for c in checks:
    print(c, c in content)
