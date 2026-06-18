import re
html = open(r"C:\Users\user\Desktop\BREM\admin.html", encoding="utf-8").read()
print(len(html.splitlines()))
for s in re.findall(r'<script[^>]*src="([^"]+)"', html):
    print(s)
