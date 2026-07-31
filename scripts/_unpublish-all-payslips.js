#!/usr/bin/env node
/**
 * 현재 라이더앱에 노출(공개) 중인 급여명세서를 전부 '미반영(숨김)'으로 되돌린다.
 *
 *   node scripts/_unpublish-all-payslips.js            ← 미리보기(쓰기 없음)
 *   node scripts/_unpublish-all-payslips.js --apply     ← 실제 미반영 처리
 *
 * - payroll_slip_lines 중 rider_published_at 이 있는 행만 대상 → null 로.
 * - 금액/주차 등 다른 값은 절대 안 건드린다. (숨기기만)
 * - 되돌리려면 관리자 「급여명세서 반영하기」로 원하는 주차만 다시 공개하면 된다.
 */
const path = require('path'); const fs = require('fs');
(function loadEnv(){const p=path.join(__dirname,'..','.env');try{require('dotenv').config({path:p});return;}catch(_){}
if(!fs.existsSync(p))return;for(const l of fs.readFileSync(p,'utf8').split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith('#'))continue;const e=t.indexOf('=');if(e<0)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;}})();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY, { auth:{persistSession:false} });
const APPLY = process.argv.includes('--apply');
const DOW=['일','월','화','수','목','금','토'];
function dow(d){const dt=new Date(`${d}T00:00:00`);return Number.isNaN(dt.getTime())?'?':DOW[dt.getDay()];}
(async () => {
  let all=[];
  for(let off=0;;off+=1000){const {data,error}=await supabase.from('payroll_slip_lines').select('id,upload_id,rider_published_at,raw_data,pay_month').range(off,off+999);if(error){console.error(error.message);process.exit(1);}if(!data||!data.length)break;all=all.concat(data);if(data.length<1000)break;}
  const published = all.filter(r => r.rider_published_at != null);
  const byWeek={};
  published.forEach(r=>{const w=String(r.raw_data?.settlementWeekStart||r.pay_month||'?').slice(0,10);const k=`${w}(${dow(w)})`;byWeek[k]=(byWeek[k]||0)+1;});
  console.log(`\n=== 전체 급여명세서 미반영 (${APPLY?'실제 적용':'미리보기'}) ===`);
  console.log(`전체 행: ${all.length} · 공개중: ${published.length} · 대기: ${all.length-published.length}`);
  console.log('\n[공개중 주차별]');
  Object.keys(byWeek).sort().forEach(k=>console.log(`  ${k} : ${byWeek[k]}건`));
  if(!published.length){console.log('\n숨길 공개중 행이 없습니다.');return;}
  if(!APPLY){console.log('\n미리보기입니다. 실제로 숨기려면 --apply 를 붙여 다시 실행하세요.');return;}
  const now=new Date().toISOString();
  const ids=published.map(r=>r.id);let done=0;
  for(let i=0;i<ids.length;i+=200){const chunk=ids.slice(i,i+200);const {error:e2}=await supabase.from('payroll_slip_lines').update({rider_published_at:null,updated_at:now}).in('id',chunk);if(e2){console.error(e2.message);process.exit(1);}done+=chunk.length;console.log(`  ...${done}/${ids.length}`);}
  console.log(`\n완료: ${done}건 전부 미반영(숨김). 이제 라이더앱에 급여명세서가 안 보입니다.`);
})();
