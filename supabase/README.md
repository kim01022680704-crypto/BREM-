# BREM Supabase 설계

## localStorage → Supabase 매핑

| Supabase 테이블 | localStorage 키 | 설명 |
|----------------|-----------------|------|
| `riders` | `brem_driver_management_drivers` | 기사 정보 |
| `promotions` | `brem_admin_promotion_rules` (헤더) | 프로모션 조건 |
| `promotion_rules` | `brem_admin_promotion_rules` (block/bonus/reference) | 세부 조건 |
| `weekly_settlements` | `brem_admin_weekly_settlements` (헤더) | 주간정산 |
| `weekly_settlement_riders` | `brem_admin_weekly_settlements.riders[]` | 기사별 정산 |
| `regions` | weekly_settlements.region 등에서 추출 | 지역 목록 |
| `rider_name_mappings` | `brem_admin_manual_name_mappings` | 수동 매칭 |
| `notices` | `brem_admin_notices` | 공지 |
| `users` | 기사 login + 관리자 계정 | 로그인 |
| `system_kv_store` | calls, targets, promotion_settings 등 | 나머지 키 보존 |

## 테이블 컬럼 요약

### riders
`id`, `name`, `phone`, `resident_number`, `password`, `bank_name`, `account_holder`, `account_number`, `baemin_id`, `platform_coupang`, `platform_baemin`, `long_event_item_id`, `long_event_item`, `long_event_start_date`, `join_date`, `status`, `memo`, `hidden_fields`, `promotion_selector_*`, `promotion_rule_id_*`, `created_at`, `updated_at`

### promotions
`id`, `name`, `type`, `platform`, `enabled`, `selector_key`, `start_date`, `end_date`, `base`(jsonb), `priority`, `allow_duplicate`, `duplicate_strategy`, `apply_global_accept_block`, `no_pay_conditions`

### promotion_rules
`id`, `promotion_id`, `kind`(block/bonus/reference), `condition_name`, `condition_type`, `processing_mode`, `payload`(jsonb), `sort_order`

### weekly_settlements
`id`, `platform`, `region_id`, `region_name`, `file_name`, `base_settlement_date`, `start_date`, `end_date`, `payment_date`, `settlement_week_label`, `matched_names_label`, `summary`(jsonb), `uploaded_at`

### weekly_settlement_riders
`id`, `weekly_settlement_id`, `rider_id`, `original_name`, `rider_name`, `driver_name`, `matched`, `weekly_order_count`, `system_call_count`, `call_count_matched`, `coupang_login_key`, `baemin_user_id`, `warnings`(jsonb)

### regions
`id`, `name`, `platform`, `slug`, `active`

### rider_name_mappings
`id`, `platform`, `original_name`, `rider_id`, `driver_name`

### notices
`id`, `title`, `content`, `pinned`, `created_at`, `updated_at`

### users
`id`, `role`(admin/rider), `rider_id`, `login_id`, `password_hash`, `display_name`, `active`

## 설정 방법

1. Supabase SQL Editor에서 `supabase/schema.sql` 실행
2. `js/supabase-config.example.js` → `js/supabase-config.js` 복사 후 URL/anon key 입력
3. admin.html에 Supabase SDK + config + adapter 스크립트 로드
4. admin **데이터 백업** → **Supabase로 이전** 실행
5. 전환 시 `backend: 'supabase'` 설정 후 `await BremStorage.initStorage()` 호출

## Adapter 패턴

```
localAdapter (localStorage)
       ↕
storageAdapter (proxy) ← activeStorageAdapter
       ↕
BremSupabaseStorageAdapter (메모리 캐시 + Supabase sync)
```

- 기본: `local` (기존과 동일)
- `BremStorage.initStorage({ backend: 'supabase' })` → Supabase hydrate
- `BremStorage.migrateLocalStorageToSupabase(client)` → localStorage 일회 이전

## 주의

- `localStorage.clear()` 사용하지 않음
- 마이그레이션은 **upsert** (기존 Supabase 데이터 덮어쓰기 가능 → 백업 권장)
- `system_kv_store`에 콜수·목표·프로모션 설정 등 relational 미분리 데이터 보존
- 운영 전 `password_hash` bcrypt 전환 권장 (현재는 localStorage 평문 이전)
