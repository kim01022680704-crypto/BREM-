import re

SRC = r"C:\Users\user\Desktop\BREM\_restore_tmp\admin_reconstructed.html"
OUT = r"C:\Users\user\Desktop\BREM\admin.html"

LOGIN = """  <section class="login-page" id="adminLoginPage">
    <div class="login-canvas">
      <img
        class="login-canvas__ref"
        src="assets/admin/login-bg.png"
        width="768"
        height="1024"
        alt="BREM 관리자 로그인"
        draggable="false"
      >
      <form class="login-canvas__form" id="adminLoginForm">
        <label class="login-hit login-hit--id">
          <span class="sr-only">아이디</span>
          <input type="text" id="adminName" autocomplete="username" required>
        </label>

        <label class="login-hit login-hit--pw">
          <span class="sr-only">비밀번호</span>
          <input type="password" id="adminPassword" autocomplete="current-password" required>
        </label>

        <button type="button" class="login-hit login-hit--toggle" id="adminPasswordToggle" aria-label="비밀번호 표시"></button>

        <button type="submit" class="login-hit login-hit--submit">
          <span class="sr-only">로그인</span>
        </button>
      </form>
    </div>
    <p class="login-help" id="adminLoginHelp" hidden></p>
  </section>"""

NAV = """      <nav>
        <button class="nav-btn active" data-section="dashboard">대시보드</button>
        <button class="nav-btn" data-section="calls">콜수 입력</button>
        <button class="nav-btn" data-section="rejections">거절율 입력</button>
        <button class="nav-btn" data-section="targets">목표 콜수</button>
        <button class="nav-btn" data-section="missions">장기근속이벤트</button>
        <button class="nav-btn" data-section="promotions">프로모션 관리</button>
        <button class="nav-btn" data-section="promotion-apply">프로모션 적용</button>
        <button class="nav-btn" data-section="settlements">일정산서 업로드</button>
        <button class="nav-btn" data-section="weekly-settlement">주정산서 업로드</button>
        <button class="nav-btn" data-section="notices">공지사항</button>
        <button class="nav-btn" data-section="admin-account">관리자 계정</button>
        <button class="nav-btn" data-section="data-backup">데이터 백업</button>
      </nav>"""

DASHBOARD_STATS = """        <div class="stats-grid">
          <article class="stat-card">
            <span>등록 기사</span>
            <strong id="statDrivers">0명</strong>
          </article>
          <article class="stat-card">
            <span>주간 콜수 (쿠팡)</span>
            <strong id="statWeekCallsCoupang">0콜</strong>
          </article>
          <article class="stat-card">
            <span>주간 콜수 (배민)</span>
            <strong id="statWeekCallsBaemin">0콜</strong>
          </article>
          <article class="stat-card">
            <span>주간 콜수 (합계)</span>
            <strong id="statWeekCallsTotal">0콜</strong>
          </article>
          <article class="stat-card">
            <span>이번 달 콜수</span>
            <strong id="statMonthCalls">0콜</strong>
          </article>
        </div>"""

def platform_call_panel(platform, label):
    rate_label = "거절율" if platform == "coupang" else "수락율"
    hidden = ' hidden' if platform == "baemin" else ""
    return f"""        <div class="admin-platform-panel" id="calls-{platform}" data-platform="{platform}"{hidden}>
        <article class="card call-input-card">
          <div class="card-header">
            <h2>기사별 콜수 입력 ({label})</h2>
          </div>
          <form class="form-row call-daily-form" id="callForm-{platform}" data-platform="{platform}">
            <label>
              기사
              <select id="callDriver-{platform}" class="call-driver" required></select>
            </label>
            <label class="call-date-field">
              <span>날짜</span>
              <button type="button" class="call-date-picker-btn" data-call-date-trigger data-call-date-target="callDate-{platform}" data-call-date-label="callDateLabel-{platform}">
                <span id="callDateLabel-{platform}">날짜 선택</span>
              </button>
              <input type="hidden" id="callDate-{platform}" required>
            </label>
            <label>
              콜수
              <input type="number" id="callCount-{platform}" min="0" placeholder="0" required>
            </label>
            <button class="primary-btn" type="submit">저장</button>
          </form>
          <p class="form-help">{label} 콜수를 하루 단위로 입력하면 주간·월간·장기근속이벤트 콜수가 자동으로 계산됩니다.</p>
        </article>

        <article class="card">
          <div class="card-header">
            <h2>{label} 콜수 기록</h2>
          </div>
          <div class="call-records-toolbar">
            <label class="call-filter-field">
              <span>날짜</span>
              <button type="button" class="call-date-picker-btn call-date-picker-btn--compact" data-call-date-trigger data-call-date-target="callFilterDate-{platform}" data-call-date-label="callFilterDateLabel-{platform}">
                <span id="callFilterDateLabel-{platform}">날짜 선택</span>
              </button>
              <input type="hidden" id="callFilterDate-{platform}">
            </label>
            <button type="button" class="small-btn danger-btn" id="bulkDeleteCalls-{platform}" disabled>선택 삭제</button>
          </div>
          <div class="table-wrap">
            <table class="call-records-table">
              <thead>
                <tr>
                  <th class="col-select">
                    <input type="checkbox" id="selectAllCalls-{platform}" class="call-select-all" aria-label="전체 선택">
                  </th>
                  <th>기사</th>
                  <th>콜수</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody id="callRows-{platform}"></tbody>
            </table>
          </div>
        </article>
        </div>"""


def platform_rejection_panel(platform, label):
    rate_label = "거절율" if platform == "coupang" else "수락율"
    hidden = ' hidden' if platform == "baemin" else ""
    return f"""        <div class="admin-platform-panel" id="rejections-{platform}" data-platform="{platform}"{hidden}>
        <article class="card">
          <div class="card-header rejection-card-header">
            <h2>기사별 주간 {rate_label} 입력 ({label})</h2>
            <div class="week-nav week-nav-center">
              <button type="button" class="small-btn" id="rejectionPrevWeekBtn-{platform}">&lt;&lt;</button>
              <label class="week-nav-date-field">
                <span class="field-preview" id="rejectionWeekPreview-{platform}">수요일~화요일 기준</span>
                <input type="date" id="rejectionWeekDate-{platform}" required>
              </label>
              <button type="button" class="small-btn" id="rejectionNextWeekBtn-{platform}">&gt;&gt;</button>
            </div>
          </div>
          <form class="form-row rejection-input-form" id="rejectionForm-{platform}" data-platform="{platform}">
            <label>
              기사
              <select id="rejectionDriver-{platform}" class="rejection-driver" required></select>
            </label>
            <label>
              주간 {rate_label} (%)
              <input type="number" id="rejectionRate-{platform}" min="0" max="100" step="0.1" placeholder="예: 10" required>
            </label>
            <button class="primary-btn" type="submit">{rate_label} 저장</button>
          </form>
          <p class="form-help">{label} 주간 {rate_label}입니다. 수~화 기준으로 입력할 때마다 해당 주의 최신 값으로 저장됩니다.</p>
        </article>

        <article class="card">
          <div class="card-header">
            <h2>{label} 주간 {rate_label} 기록</h2>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>적용주</th>
                  <th>기사</th>
                  <th>{rate_label}</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody id="rejectionRows-{platform}"></tbody>
            </table>
          </div>
        </article>
        </div>"""


CALLS_SECTION = f"""      <section class="section" id="calls">
        <div class="promotion-platform-tabs admin-section-tabs" role="tablist">
          <button type="button" class="promotion-tab active" data-admin-platform-tab="calls" data-platform="coupang">쿠팡</button>
          <button type="button" class="promotion-tab" data-admin-platform-tab="calls" data-platform="baemin">배민</button>
        </div>
{platform_call_panel("coupang", "쿠팡")}
{platform_call_panel("baemin", "배민")}
      </section>"""

REJECTIONS_SECTION = f"""      <section class="section" id="rejections">
        <div class="promotion-platform-tabs admin-section-tabs" role="tablist">
          <button type="button" class="promotion-tab active" data-admin-platform-tab="rejections" data-platform="coupang">쿠팡</button>
          <button type="button" class="promotion-tab" data-admin-platform-tab="rejections" data-platform="baemin">배민</button>
        </div>
{platform_rejection_panel("coupang", "쿠팡")}
{platform_rejection_panel("baemin", "배민")}
      </section>"""

MISSIONS_INNER = """        <div class="grid two">
          <article class="card">
            <div class="card-header">
              <h2>등록된 이벤트 아이템</h2>
            </div>
            <div id="eventItemList" class="mission-list"></div>
          </article>

          <article class="card">
            <div class="card-header">
              <h2>기사별 이벤트 설정</h2>
            </div>
            <div id="eventSettings" class="bike-settings"></div>
          </article>
        </div>"""


def replace_section(content, section_id, new_body):
    pattern = rf'<section class="section"[^>]*id="{section_id}"[^>]*>.*?</section>'
    return re.sub(pattern, new_body, content, count=1, flags=re.DOTALL)


html = open(SRC, encoding="utf-8").read()

# head
html = html.replace(
    '  <link rel="stylesheet" href="css/admin.css">\n</head>',
    '  <link rel="stylesheet" href="css/admin.css">\n  <link rel="stylesheet" href="css/admin-login.css">\n</head>',
)

# login + adminApp wrapper
html = html.replace("<body>\n  <div class=\"admin-app\">", f"<body>\n{LOGIN}\n\n  <div class=\"admin-app app-hidden\" id=\"adminApp\">")

# nav
html = re.sub(r"<nav>.*?</nav>", NAV, html, count=1, flags=re.DOTALL)

# dashboard stats
html = re.sub(
    r'<div class="stats-grid">.*?</div>\s*\n\s*<div class="grid two">',
    DASHBOARD_STATS + '\n\n        <div class="grid two">',
    html,
    count=1,
    flags=re.DOTALL,
)

# dashboard table header
html = html.replace(
    """            <div class="card-header">
              <h2>기사별 이번 달 현황</h2>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>로그인 아이디</th>
                    <th>기사명</th>
                    <th>상태</th>
                    <th>콜수</th>
                    <th>월간 목표</th>
                    <th>달성률</th>
                  </tr>
                </thead>""",
    """            <div class="card-header">
              <h2>기사별 현황</h2>
              <span class="dashboard-week-label" id="dashboardWeekLabel">-</span>
            </div>
            <div class="table-wrap">
              <table class="dashboard-table">
                <thead>
                  <tr>
                    <th>기사</th>
                    <th>연락처</th>
                    <th>상태</th>
                    <th>주간 콜 (쿠팡)</th>
                    <th>주간 콜 (배민)</th>
                    <th>주간 합계</th>
                    <th>월간 콜수</th>
                    <th>장기근속이벤트</th>
                  </tr>
                </thead>""",
)

# remove duplicate old promotions block
html = re.sub(
    r'\s*<section class="section" id="promotions">\s*<article class="card">\s*<div class="card-header">\s*<h2>프로모션 자동 계산</h2>.*?</section>\s*\n\s*<section class="section" id="missions">',
    '\n\n      <section class="section" id="missions">',
    html,
    count=1,
    flags=re.DOTALL,
)

# missions grid fix (only inside missions section)
html = re.sub(
    r'(<section class="section" id="missions">.*?<form class="form-row" id="missionForm">.*?</form>\s*<p class="hint">[^<]*</p>\s*)<div class="grid two">.*?</div>\s*(<article class="card">\s*<div class="card-header">\s*<h2>장기근속이벤트 현황</h2>.*?</article>)',
    r'\1' + MISSIONS_INNER + r'\n\n        \2',
    html,
    count=1,
    flags=re.DOTALL,
)

# mission form hint
html = html.replace(
    '            <button class="primary-btn" type="submit">이벤트 목표 저장</button>',
    '            <button class="primary-btn" type="submit">이벤트 아이템 등록</button>',
)
html = html.replace(
    '              목표 아이템',
    '              아이템 이름',
)
html = html.replace(
    '          <p class="hint">기사별 이벤트 아이템은 기사 등록 화면의 기본값과 연결되며, 이 화면에서도 조정할 수 있습니다.</p>',
    '          <p class="hint">등록한 아이템은 기사별 설정과 기사 등록 화면에서 선택할 수 있습니다.</p>',
)

# calls + rejections sections
html = replace_section(html, "calls", CALLS_SECTION)
html = replace_section(html, "rejections", REJECTIONS_SECTION)

# fix stray closing div in rejections if any leftover
html = html.replace("        </article>\n        </div>\n      </section>\n\n      <section class=\"section\" id=\"targets\">",
                    "      </section>\n\n      <section class=\"section\" id=\"targets\">")

with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write(html)

scripts = re.findall(r'<script[^>]*src="([^"]+)"', html)
print(f"Written {OUT}")
print(f"Lines: {html.count(chr(10)) + 1}")
print("Scripts:")
for s in scripts:
    print(f"  {s}")
