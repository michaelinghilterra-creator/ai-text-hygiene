// ai-text-hygiene tests. Plain node, no framework. `node test/test.mjs`.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { clean, cleanText, stripInvisible, cleanConservative, analyzeCadence, formatCadenceReport, analyzeStyle, stripRedundantFiller, analyzeVoice, formatVoiceReport, disclosureLine, disclose } from '../src/index.mjs';

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

// --- voice -------------------------------------------------------------------
const VOICE_SAMPLES = [
  "I like to start in the garden early. It's quiet then, and I can see what needs water. I don't rush the work. My tomatoes get a slow soak near the roots. I've learned that wet leaves can cause trouble. The basil grows beside them. I pick a few leaves when I'm making lunch. My small shovel stays by the back step. I can't remember where it is otherwise. Some mornings I just pull weeds. Other days, I'll tie up a leaning stem. I keep the jobs short. That way, I don't get tired of them.",
  "I bake in the afternoon when I have time. My bread isn't fancy, but it tastes good. I mix the dough in a wide bowl. I don't mind if flour gets on the counter. That's part of baking at home. I've used the same wooden spoon for years. It fits my hand. The dough usually needs more water than I expect. I add it a little at a time. Then I'll cover the bowl with a towel. I let it sit near the window. When it's ready, I shape one plain loaf. I don't fuss with it. The crust gets brown and crisp. I wait before cutting it, though that's hard. Fresh bread always smells better than it looks."
].join('\n\n');
const VOICE_AI_DRAFT = 'To delve into home gardening, I leverage a seamless approach that combines careful observation, meticulously timed watering, and a comprehensive understanding of each plant, because I do not want any detail to escape notice while I cultivate a robust and vibrant garden throughout the season. I am also applying this holistic method to baking, where I utilize strategic preparation and do not cut the bread until every pivotal stage is complete.';
const VOICE_MATCH_DRAFT = "I check the garden after breakfast. I don't stay out there long. My watering can sits beside the steps, so I won't forget it. Later, I'll mix bread dough in my old bowl. It isn't fancy. I let the loaf cool before I cut it, though waiting is never easy.";

const voiceBad = analyzeVoice(VOICE_AI_DRAFT, VOICE_SAMPLES);
const voiceGood = analyzeVoice(VOICE_MATCH_DRAFT, VOICE_SAMPLES);
check(!voiceBad.insufficient && voiceBad.score < 50, `different voice scores low (${voiceBad.score})`);
check(voiceBad.flags.some((f) => f.type === 'vocab' && f.message.includes('"delve"')), 'voice flags delve as new vocabulary');
check(voiceBad.sentences.some((s) => s.reasons.some((r) => r.startsWith('longer than'))), 'voice flags an unusual sentence length');
check(voiceBad.sentences.some((s) => s.reasons.some((r) => r.startsWith('you usually contract'))), 'voice flags an uncontracted phrase');
check(!voiceGood.insufficient && voiceGood.score > 70, `matching voice scores high (${voiceGood.score})`);
check(!voiceGood.flags.some((f) => f.type === 'vocab'), 'matching voice has no vocabulary flags');
const sharedVocab = analyzeVoice(VOICE_MATCH_DRAFT + ' I leverage a small shelf.', VOICE_SAMPLES + ' I leverage a small shelf when the counter is full.');
check(!sharedVocab.flags.some((f) => f.type === 'vocab' && f.message.includes('"leverage"')), 'vocabulary shared with samples is not flagged');
const shortSamples = analyzeVoice(VOICE_MATCH_DRAFT, 'I garden.');
const shortDraft = analyzeVoice('I garden.', VOICE_SAMPLES);
check(shortSamples.insufficient && shortSamples.score === null && /samples/.test(shortSamples.reason), 'short voice samples are insufficient');
check(shortDraft.insufficient && shortDraft.score === null && /draft/.test(shortDraft.reason), 'short voice draft is insufficient');
eq(analyzeVoice(VOICE_MATCH_DRAFT, [VOICE_SAMPLES.slice(0, 300), VOICE_SAMPLES.slice(300)]).score, analyzeVoice(VOICE_MATCH_DRAFT, VOICE_SAMPLES.slice(0, 300) + '\n\n' + VOICE_SAMPLES.slice(300)).score, 'array voice samples equal joined samples');
check(analyzeVoice(null, 'x').insufficient, 'analyzeVoice null draft is insufficient');
check(analyzeVoice('x', null).insufficient, 'analyzeVoice null samples are insufficient');
check(formatVoiceReport(voiceBad).startsWith('voice:'), 'scored voice report renders');
check(formatVoiceReport(shortSamples).startsWith('voice:'), 'insufficient voice report renders');
const curlyContraction = analyzeVoice('I water the garden.', 'I don' + C(0x2019) + 't water at noon.', { minDraftWords: 0, minSampleWords: 0 });
check(curlyContraction.features.find((f) => f.name === 'contractions').yours > 0, 'curly apostrophe counts as a contraction');

// --- disclose ----------------------------------------------------------------
eq(disclosureLine(), 'Written with help from an AI assistant and reviewed by me.', 'assisted disclosure text');
eq(disclosureLine({ level: 'drafted' }), 'First drafted with an AI assistant, then edited and checked by me.', 'drafted disclosure text');
eq(disclosureLine({ level: 'edited' }), 'Written by me, with editing help from an AI assistant.', 'edited disclosure text');
eq(disclosureLine({ tool: 'Garden Helper' }), 'Written with help from Garden Helper and reviewed by me.', 'custom disclosure tool');
eq(disclosureLine({ format: 'markdown' }), '_Written with help from an AI assistant and reviewed by me._', 'markdown disclosure');
eq(disclosureLine({ tool: '<b>', format: 'html' }), '<p class="ai-disclosure">Written with help from &lt;b&gt; and reviewed by me.</p>', 'html disclosure escapes tool');
let badLevel = false, badFormat = false;
try { disclosureLine({ level: 'bogus' }); } catch (error) { badLevel = error instanceof TypeError; }
try { disclosureLine({ format: 'bogus' }); } catch (error) { badFormat = error instanceof TypeError; }
check(badLevel, 'unknown disclosure level throws TypeError');
check(badFormat, 'unknown disclosure format throws TypeError');
const disclosed = disclose('I planted basil.');
eq(disclosed, 'I planted basil.\n\nWritten with help from an AI assistant and reviewed by me.', 'disclose appends with a blank line');
check(!disclose('I planted basil.').endsWith('\n') && disclose('I planted basil.\n').endsWith('\n'), 'disclose preserves trailing newline state');
eq(disclose(disclosed), disclosed, 'disclose is idempotent');
const markdownDisclosed = disclose('I baked bread.', { format: 'markdown' });
eq(disclose(markdownDisclosed), markdownDisclosed, 'markdown disclosure is found by text check');
eq(disclose(''), disclosureLine(), 'empty text returns disclosure line');
check(disclose(null) === null, 'disclose passes null through');

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(testDir, '../bin/cli.mjs');
const samplePath = path.join(os.tmpdir(), `ai-text-hygiene-voice-${process.pid}.txt`);
fs.writeFileSync(samplePath, VOICE_SAMPLES);
const cliVoice = spawnSync(process.execPath, [cliPath, '--voice', samplePath], { input: VOICE_MATCH_DRAFT, encoding: 'utf8' });
const cliDisclose = spawnSync(process.execPath, [cliPath, '--disclose=drafted'], { input: 'I planted mint.', encoding: 'utf8' });
const cliBogus = spawnSync(process.execPath, [cliPath, '--disclose=bogus'], { input: 'I planted mint.', encoding: 'utf8' });
fs.unlinkSync(samplePath);
check(cliVoice.status === 0 && cliVoice.stdout.startsWith('voice:'), 'CLI voice report smoke test');
check(cliDisclose.status === 0 && cliDisclose.stdout.endsWith('First drafted with an AI assistant, then edited and checked by me.'), 'CLI drafted disclosure smoke test');
check(cliBogus.status === 1, 'CLI unknown disclosure level exits 1');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
