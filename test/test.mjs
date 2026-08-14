// ai-text-hygiene tests. Plain node, no framework. `node test/test.mjs`.
import { clean, cleanText, stripInvisible, cleanConservative, analyzeCadence, formatCadenceReport, analyzeStyle, stripRedundantFiller } from '../src/index.mjs';

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

// --- style -------------------------------------------------------------------
const AI_FLAVORED = "In today's fast-paced world I have delved into the realm of gardening to unlock the potential of my backyard, meticulously fostering synergy between soil and season to spearhead pivotal, world-class harvests that resonate. In order to leverage robust techniques, I endeavor to elevate every bed I plant across the yard.";
const PLAIN = 'I repainted the back fence last spring. It had been peeling for years, so I scraped it down, primed the bare spots, and put on two coats over a long weekend. The color finally matched the house again, and the neighbors stopped mentioning it when they walked by.';

const sBad = analyzeStyle(AI_FLAVORED);
const sGood = analyzeStyle(PLAIN);
check(!sBad.insufficient && sBad.score < 40, `AI-flavored text scores low (${sBad.score})`);
check(sBad.flags.some((f) => f.type === 'ai-vocab' && f.severity === 'high'), 'AI-flavored flags high ai-vocab');
check(!sGood.insufficient && sGood.score > 80, `plain text scores high (${sGood.score})`);
check(sGood.flags.length === 0, 'plain text has no flags');
check(analyzeStyle('too short to judge').insufficient === true, 'short input is insufficient');
check(analyzeStyle(null).insufficient === true, 'analyzeStyle(null) is insufficient, not a throw');

// low-severity RevOps words are flagged softly, not penalized hard
const soft = analyzeStyle('The new build system is robust and scalable. It streamlined the comprehensive test suite and the dynamic config loader, so the team shipped faster without babysitting every release during the busy launch week that just wrapped up.');
check(soft.flags.every((f) => f.severity === 'low'), 'soft (common-in-tech) words flag as low severity only');
// The point of decision #1: soft words penalize far less than high AI words. The
// same paragraph with soft words swapped for high ones must score much lower.
const hard = analyzeStyle('The new build system is seamless and world-class. It streamlined a holistic test suite and unlocks the potential of the dynamic config loader, so the team could elevate every release and resonate during the busy launch week that just wrapped up.');
check(!soft.insufficient && soft.score - hard.score >= 20, `soft (${soft.score}) scores well above the high-vocab version (${hard.score})`);

// bullet overload: flagged for prose, suppressed for a resume (expectBullets)
const bulletText = [
  '- I loaded the trucks each morning before the first shift arrived',
  '- I checked every pallet against the printed manifest sheet',
  '- I logged the counts into the warehouse system by hand',
  '- I trained two new hires on the receiving process',
  '- I kept the loading dock clear and organized all day',
  '- I closed out the shift report before heading home',
].join('\n');
check(analyzeStyle(bulletText).flags.some((f) => f.type === 'bullets'), 'bullet overload flagged for prose');
check(!analyzeStyle(bulletText, { expectBullets: true }).flags.some((f) => f.type === 'bullets'), 'bullet overload suppressed when expectBullets (resume)');

// stripRedundantFiller: the one safe auto-fix
check(stripRedundantFiller('In order to win we work on a daily basis.') === 'To win we work daily.', 'strip: swaps + preserves leading capital');
check(stripRedundantFiller('the majority of us have the ability to help') === 'most of us can help', 'strip: mid-sentence swaps');
check(stripRedundantFiller(stripRedundantFiller('In order to go')) === stripRedundantFiller('In order to go'), 'strip is idempotent');
check(stripRedundantFiller(null) === null, 'strip is null-safe');
check(stripRedundantFiller('nothing to change here') === 'nothing to change here', 'strip leaves clean text alone');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
