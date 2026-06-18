import json
import re
import sys

TRANSCRIPT = r"C:\Users\user\.cursor\projects\c-Users-user-Desktop-BREM\agent-transcripts\19c3f8fe-ea1c-4e74-90cb-a80d463434a2\19c3f8fe-ea1c-4e74-90cb-a80d463434a2.jsonl"
OUT_PATH = r"C:\Users\user\Desktop\BREM\_restore_tmp\admin_reconstructed.html"
# Stop before login-canvas truncated write (after transcript ends; include all transcript edits)
STOP_BEFORE_LINE = 10_000


def is_admin_html_path(p: str) -> bool:
    if not p:
        return False
    norm = p.replace("\\", "/").lower()
    return norm.endswith("admin.html")


def is_admin_html_patch(text: str) -> bool:
    if "admin.html" not in text:
        return False
    for line in text.splitlines():
        if line.startswith("*** Add File:") or line.startswith("*** Update File:"):
            return "admin.html" in line
    return False


def parse_add_file(patch: str) -> str:
    lines = []
    in_file = False
    for line in patch.splitlines():
        if line.startswith("*** Add File:") and "admin.html" in line:
            in_file = True
            continue
        if in_file:
            if line.startswith("***"):
                break
            if line.startswith("+"):
                lines.append(line[1:])
    return "\n".join(lines)


def apply_update_patch(content: str, patch: str) -> tuple[str, int, int]:
    ok = miss = 0
    for hunk in re.finditer(r"@@.*?@@\n(.*?)(?=\n@@|\n\*\*\* End Patch|\Z)", patch, re.DOTALL):
        hunk_text = hunk.group(1)
        old_lines, new_lines = [], []
        for pline in hunk_text.splitlines():
            if pline.startswith("-"):
                old_lines.append(pline[1:])
            elif pline.startswith("+"):
                new_lines.append(pline[1:])
            elif pline.startswith(" "):
                old_lines.append(pline[1:])
                new_lines.append(pline[1:])
        old = "\n".join(old_lines)
        new = "\n".join(new_lines)
        if old in content:
            content = content.replace(old, new, 1)
            ok += 1
        else:
            miss += 1
    return content, ok, miss


def collect_ops():
    ops = []
    with open(TRANSCRIPT, encoding="utf-8") as f:
        for jsonl_line, line in enumerate(f, 1):
            if jsonl_line >= STOP_BEFORE_LINE:
                break
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            msg = obj.get("message", {})
            if not isinstance(msg, dict):
                continue
            for part in msg.get("content", []):
                if part.get("type") != "tool_use":
                    continue
                name = part.get("name")
                inp = part.get("input")
                if name == "Write" and isinstance(inp, dict) and is_admin_html_path(inp.get("path", "")):
                    ops.append((jsonl_line, "write", inp.get("contents", "")))
                elif name == "StrReplace" and isinstance(inp, dict) and is_admin_html_path(inp.get("path", "")):
                    ops.append((jsonl_line, "replace", inp.get("old_string", ""), inp.get("new_string", "")))
                elif name == "ApplyPatch":
                    patch = inp if isinstance(inp, str) else ""
                    if is_admin_html_patch(patch):
                        ops.append((jsonl_line, "patch", patch))
    return ops


def main():
    ops = collect_ops()
    print(f"Collected {len(ops)} operations")

    content = None
    stats = {"write": 0, "replace_ok": 0, "replace_miss": 0, "patch_ok": 0, "patch_miss": 0}

    for jsonl_line, kind, *args in ops:
        if kind == "write":
            content = args[0]
            stats["write"] += 1
        elif kind == "patch":
            patch = args[0]
            if "*** Add File:" in patch:
                content = parse_add_file(patch)
                stats["patch_ok"] += 1
            elif "*** Update File:" in patch and content is not None:
                content, ok, miss = apply_update_patch(content, patch)
                stats["patch_ok"] += ok
                stats["patch_miss"] += miss
        elif kind == "replace":
            old, new = args
            if content is None:
                stats["replace_miss"] += 1
                continue
            if old in content:
                content = content.replace(old, new, 1)
                stats["replace_ok"] += 1
            else:
                stats["replace_miss"] += 1
                if stats["replace_miss"] <= 5:
                    print(f"  miss L{jsonl_line}: {old[:80]!r}")

    if not content:
        print("ERROR: no content")
        sys.exit(1)

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)

    print("Stats:", stats)
    print(f"Lines: {content.count(chr(10)) + 1}")
    print("Has </html>:", "</html>" in content)
    print("Sections:", re.findall(r'<section class="section"[^>]*id="([^"]+)"', content))
    scripts = re.findall(r'<script[^>]*src="([^"]+)"', content)
    print("Scripts:", scripts)


if __name__ == "__main__":
    main()
