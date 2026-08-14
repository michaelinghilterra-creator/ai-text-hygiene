// ai-text-hygiene tests. Plain node, no framework. `node test/test.mjs`.
import { clean, cleanText, stripInvisible, cleanConservative, analyzeCadence, formatCadenceReport } from '../src/index.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ok   ${msg}`); passed++; }
  else { console.log(`  FAIL ${msg}`); failed++; }
}
const eq = (got, exp, msg) => check(got === exp, `${msg}  => ${JSON.stringify(got)}`);
const C = (cp) => String.fromCharCode(cp);
const ZWSP = C(0x200B), BOM = C(0xFEFF), RLO = C(0x202E), NBSP = C(0x00A0);
const EM = C(0x2014), HELL = C(0x2026), LDQ = C(0x201C), RDQ = C(0x201D), RSQ = C(0x2019);
const LOWQ = C(0x201E); // German low quote

console.log('ai-text-hygiene test');

// Universal
eq(stripInvisible('a' + ZWSP + 'b'), 'ab', 'zero-width stripped');
eq(stripInvisible(BOM + 'a' + RLO + 'b'), 'ab', 'BOM + bidi override stripped');
eq(stripInvisible('a' + NBSP + 'b'), 'a b', 'nbsp -> space');
eq(stripInvisible('a\tb\nc'), 'a\tb\nc', 'tab + newline preserved');

// House-style
eq(clean('a ' + EM + ' b'), 'a, b', 'em dash -> comma');
eq(clean('a--b'), 'a, b', 'double hyphen -> comma');
eq(clean(LDQ + 'x' + RDQ + ' don' + RSQ + 't' + HELL), '"x" don\'t...', 'curly + ellipsis folded');

// Protected spans
eq(clean('see https://x.com/a--b' + EM + 'c'), 'see https://x.com/a--b' + EM + 'c', 'URL untouched');
eq(clean('run `a--b' + EM + '`'), 'run `a--b' + EM + '`', 'inline code untouched');

// Conservative is length-stable
const slot = 'Ops ' + EM + ' ' + LDQ + 'lead' + RDQ + NBSP + 'role' + ZWSP;
check(cleanConservative(slot).length <= slot.length, 'conservative only shrinks/holds length');
check(cleanConservative(slot).includes(EM), 'conservative does not expand em dash');
check(cleanConservative(slot).includes('"lead"'), 'conservative folds curly quotes');

// Homoglyph opt-in only; non-English left alone by stripInvisible
eq(clean(C(0x0410) + 'pple'), C(0x0410) + 'pple', 'homoglyph NOT folded by default');
eq(cleanText(C(0x0410) + 'pple', { foldHomoglyphs: true }), 'Apple', 'homoglyph folded when enabled');
eq(stripInvisible(LOWQ + 'Gut' + RDQ), LOWQ + 'Gut' + RDQ, 'stripInvisible keeps non-English quotes');

// Idempotent + null-safe
const messy = LDQ + 'a' + RDQ + ' ' + EM + ' b' + HELL + ' c--d' + ZWSP;
eq(clean(clean(messy)), clean(messy), 'clean is idempotent');
check(clean(null) === null, 'null passes through');

// --- cadence -----------------------------------------------------------------
const MONOTONE = Array.from({ length: 8 }, (_, i) =>
  `Led the effort number ${i} to deliver a platform that improved reporting speed for the whole team`).join('\n');
const VARIED = [
  'I build tools.', 'It worked.', 'Now they self-serve.',
  'Last year I rebuilt the forecasting model from scratch and it cut error nearly in half within two quarters.',
  'The team had been flying blind on pipeline, so I instrumented every stage and gave them one dashboard to trust.',
  'Adoption hit ninety percent in a month.', 'Not because I mandated it.',
].join('\n');

const mono = analyzeCadence(MONOTONE);
const vary = analyzeCadence(VARIED);
check(!mono.insufficient && mono.score < 45, `monotone scores low (${mono.score})`);
check(mono.flags.some((f) => f.type === 'low-variance'), 'monotone flags low-variance');
check(!vary.insufficient && vary.score > 65, `varied scores high (${vary.score})`);
check(vary.flags.length === 0, 'varied has no flags');
check(analyzeCadence('one.\ntwo.').insufficient === true, 'too-few-lines is insufficient');
check(analyzeCadence('one.\ntwo.').score === null, 'insufficient score is null');
check(typeof formatCadenceReport(mono) === 'string' && /cadence:/.test(formatCadenceReport(mono)), 'formatCadenceReport renders');
check(formatCadenceReport(analyzeCadence('a.\nb.')).includes('insufficient'), 'report states insufficient for tiny input');
// null-safe
check(analyzeCadence(null).insufficient === true, 'analyzeCadence(null) is insufficient, not a throw');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
