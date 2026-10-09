const { pickAcceptance } = require('../server/baemin-stats-extract');

function check(name, ok) {
  if (!ok) {
    console.error('FAIL', name);
    process.exitCode = 1;
    return;
  }
  console.log('ok', name);
}

const withOut = pickAcceptance({
  deliveryAcceptanceCount: {
    totalComplete: 28,
    allDayComplete: 30,
    slaOutComplete: 2
  }
});
check('slaOut kept', withOut.slaOutComplete === 2);
check('allDay is completeTotal', withOut.completeTotal === 30);
check('slaComplete separate', withOut.slaComplete === 28);

const merged = pickAcceptance({
  deliveryAcceptanceCount: {
    totalComplete: 30,
    allDayComplete: 30,
    slaComplete: 28,
    slaOutComplete: 2
  }
});
check('merged aliases', merged.slaOutComplete === 2 && merged.allDayComplete === 30);

if (!process.exitCode) console.log('all passed');
