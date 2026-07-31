#!/usr/bin/env node
/**
 * 특정 업로드 배치(upload_id)의 급여명세서를 '미반영(숨김)'으로 되돌린다.
 *
 *   node scripts/_unpublish-batch.js <upload_id>            ← 미리보기(쓰기 없음)
 *   node scripts/_unpublish-batch.js <upload_id> --apply     ← 실제 미반영 처리
 *
 * - rider_published_at = null 로만 바꾼다. 금액/주차 등 다른 값은 절대 안 건드린다.
 * - 되돌리려면 관리자 「급여명세서 반영하기」로 다시 공개하면 된다.
 */
const path = require('path'); const fs = require('fs');
(function loadEnv(){const p=path.join(__dirname,'..','.env');try{require('dotenv').config({path:p});return;}catch(_){}
if(!fs.existsSync(p))return;for(const l of fs.readFileSync(p,'utf8').split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;}})();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY, { auth:{persistSession:false} });

const APPLY = process.argv.includes('--apply');
const UPLOAD_ID = (process.argv.slice(2).find(a => !a.startsWith('--')) || '').trim();
if (!UPLOAD_ID) { console.error('upload_id 를 넣어주세요.'); process.exit(2); }

(async () => {
  const { data, error } = await supabase
    .from('payroll_slip_lines')
    .select('id,rider_name,pay_month,rider_published_at,raw_data')
    .eq('upload_id', UPLOAD_ID);
  if (error) { console.error(error.message); process.exit(1); }

  const rows = data || [];
  const published = rows.filter(r => r.rider_published_at != null);
  const week = rows[0]?.raw_data?.settlementWeekStart || rows[0]?.pay_month || '(?)';
  console.log(`\n=== 배치 미반영 (${APPLY ? '실제 적용' : '미리보기'}) ===`);
  console.log(`upload_id : ${UPLOAD_ID}`);
  console.log(`정산주    : ${week}`);
  console.log(`전체 행   : ${rows.length}`);
  console.log(`공개중    : ${published.length}  (이미 대기 ${rows.length - published.length})`);

  if (!published.length) { console.log('\n숨길 공개중 행이 없습니다.'); return; }
  if (!APPLY) { console.log('\n미리보기입니다. 실제로 숨기려면 --apply 를 붙여 다시 실행하세요.'); return; }

  const now = new Date().toISOString();
  const ids = published.map(r => r.id);
  let done = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { error: e2 } = await supabase.from('payroll_slip_lines')
      .update({ rider_published_at: null, updated_at: now }).in('id', chunk);
    if (e2) { console.error(e2.message); process.exit(1); }
    done += chunk.length; console.log(`  ...${done}/${ids.length}`);
  }
  console.log(`\n완료: ${done}건을 미반영(숨김)으로 되돌렸습니다. 이제 라이더앱에 안 보입니다.`);
})();
