// V2 (#66): does process.hrtime (monotonic clock) stop while macOS sleeps?
//
// Record:    node scripts/verify/monotonic-sleep.mjs [logFile]
//            then sleep the Mac >= 2 min, wake it, wait ~10 s, press Ctrl+C.
// Summarize: node scripts/verify/monotonic-sleep.mjs --summarize [logFile]
//
// Each line: wallMs<TAB>monoMs. Summary lists the biggest gaps between lines.
// Expected if the monotonic clock stops during sleep: dW ≈ sleep duration, dM ≈ 1000 ms.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const summarizeOnly = args[0] === '--summarize';
const logFile = (summarizeOnly ? args[1] : args[0]) ?? 'monotonic-sleep.log';

const monoMs = () => Number(process.hrtime.bigint() / 1_000_000n);

function summarize() {
  const rows = readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .map((l) => l.split('\t').map(Number));
  const gaps = [];
  for (let i = 1; i < rows.length; i++) {
    const dW = rows[i][0] - rows[i - 1][0];
    const dM = rows[i][1] - rows[i - 1][1];
    gaps.push({ at: new Date(rows[i - 1][0]).toISOString(), dW, dM, diff: dW - dM });
  }
  gaps.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  console.log(`runtime: node ${process.versions.node}${process.versions.electron ? `, electron ${process.versions.electron}` : ''}`);
  console.log(`samples: ${rows.length}, log: ${logFile}`);
  console.log('largest |dW - dM| gaps (ms):');
  console.table(gaps.slice(0, 5));
}

if (summarizeOnly) {
  summarize();
} else {
  writeFileSync(logFile, '');
  const tick = () => appendFileSync(logFile, `${Date.now()}\t${monoMs()}\n`);
  tick();
  setInterval(tick, 1000);
  console.log(`recording to ${logFile}; sleep the Mac >= 2 min, wake, wait 10 s, then Ctrl+C`);
  process.on('SIGINT', () => {
    tick();
    summarize();
    process.exit(0);
  });
}
