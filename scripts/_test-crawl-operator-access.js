const assert = require('assert');
const crawl = require('../server/crawl-operator-access');

assert.strictEqual(
  crawl.resolveCrawlAllowed({ role: 'ceo', canOperateCrawl: false }, {}).allowed,
  true,
  '대표는 크롤링 UI를 봐야 한다'
);
assert.strictEqual(
  crawl.resolveCrawlAllowed({ role: 'director', canOperateCrawl: false }, {}).allowed,
  true,
  '총괄은 크롤링 UI를 봐야 한다'
);
assert.strictEqual(
  crawl.resolveCrawlAllowed(
    { role: 'manager', canOperateCrawl: false, name: '김형진' },
    { name: '김형진' }
  ).allowed,
  true,
  '기본 운영자는 플래그가 false여도 봐야 한다'
);
assert.strictEqual(
  crawl.resolveCrawlAllowed(
    { role: 'manager', canOperateCrawl: false, email: 'kim01022680704@gmail.com' },
    { email: 'kim01022680704@gmail.com' }
  ).allowed,
  true,
  '기본 운영 이메일도 봐야 한다'
);
assert.strictEqual(
  crawl.resolveCrawlAllowed({ role: 'manager', canOperateCrawl: false, name: '다른팀장' }, {}).allowed,
  false,
  '일반 팀장은 체크 없으면 숨긴다'
);
assert.strictEqual(
  crawl.resolveCrawlAllowed({ role: 'manager', canOperateCrawl: true, name: '다른팀장' }, {}).allowed,
  true,
  '체크된 팀장은 본다'
);

console.log('crawl operator access tests: OK');
