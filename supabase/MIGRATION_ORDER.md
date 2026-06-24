# BREM Supabase Migration 실행 순서

운영 데이터는 **Supabase 전용 테이블**에 저장됩니다.  
브라우저 `localStorage` / `sessionStorage`에는 **인증 세션·UI 캐시만** 사용하며, 운영 데이터는 저장하지 않습니다.

## 실행 순서 (SQL Editor)

| 순서 | 파일 | 필수 | 설명 |
|------|------|------|------|
| 1 | `schema.sql` | 최초 1회 | profiles, riders, notices, promotions, settings, RLS |
| 2 | `missions_migration.sql` | 미션 사용 시 | missions 테이블 + `brem_is_admin()` |
| 3 | `riders_schema_sync_migration.sql` | 컬럼 누락 시 | riders 컬럼 동기화 |
| 4 | `rider_inquiries_migration.sql` | 문의 사용 시 | rider_inquiries |
| 5 | `admin_schedules_migration.sql` | **필수** | 관리자 스케줄표 |
| 6 | `operations_tables_migration.sql` | **필수** | admin_calls · admin_rejection_rates · admin_targets + settings→table |
| 7 | `settlements_tables_migration.sql` | **필수** | daily_settlements · weekly_settlements · settlement_upload_logs · settlement_unmatched + settings→table |
| 8 | `promotion_apply_results_migration.sql` | 프로모션 적용 저장 시 | promotion_apply_results (settings JSON 폴백 유지) |
| 9 | `lease_erp_migration.sql` | **리스 ERP 사용 시** | lease_vehicles · … · lease_profit_logs (brem_admin_leases 이관 지원) |
| 9b | `lease_erp_v2_columns.sql` | **리스 ERP v2** (9번 이후) | 미납일·취득세·회사소유리스 계산 필드 |
| 10 | `verify_migration_status.sql` | 실행 후 | 테이블/count/이관 검증 |

## 데이터별 저장 위치 (최종)

| 데이터 | Supabase 테이블 | settings JSON (레거시) |
|--------|-----------------|------------------------|
| 기사 / 메모 / 상태 | `riders` | ❌ |
| 공지사항 | `notices` | ❌ |
| 미션 설정 | `missions` | ❌ |
| 프로모션 조건 | `promotions` | ❌ |
| 관리자 스케줄 | `admin_schedules` | 이전만 (삭제 안 함) |
| 일별 콜수 | `admin_calls` | 이전만 |
| 주간 거절/수락율 | `admin_rejection_rates` | 이전만 |
| 월간 목표 | `admin_targets` | 이전만 |
| 일정산 반영 | `daily_settlements` | 이전만 |
| 주정산 저장 | `weekly_settlements` | 이전만 |
| 정산 업로드 기록 | `settlement_upload_logs` | 이전만 |
| 정산 미매칭 | `settlement_unmatched` | 이전만 |
| 프로모션 적용 계산 결과 | `promotion_apply_results` | 이전만 (`brem_admin_promotion_apply_results`) |
| 프로모션 UI 설정 | `settings.brem_admin_promotion_settings` | Supabase 영구 |
| 리스/수익/장기이벤트 등 | `settings` (jsonb) | Supabase 영구 |

## 실행 후 검증

```sql
-- supabase/verify_all_storage_tables.sql 실행
```

또는:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'riders', 'notices', 'missions', 'promotions',
    'admin_schedules', 'admin_calls', 'admin_rejection_rates', 'admin_targets',
    'daily_settlements', 'weekly_settlements', 'settlement_upload_logs', 'settlement_unmatched',
    'promotion_apply_results'
  )
order by 1;
```

12개 모두 조회되면 테이블 준비 완료.

## 주의

- migration은 **기존 settings JSON 행을 삭제하지 않습니다** (백업 유지).
- 앱은 전용 테이블을 **우선** 읽고 씁니다.
- `NOTIFY pgrst, 'reload schema'` 후 1~2분 API 캐시 갱신 대기.
