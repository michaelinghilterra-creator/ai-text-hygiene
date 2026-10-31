// ai-text-hygiene tests. Plain node, no framework. `node test/test.mjs`.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { clean, cleanText, stripInvisible, cleanConservative, analyzeCadence, formatCadenceReport, analyzeStyle, stripRedundantFiller, analyzeVoice, formatVoiceReport, disclosureLine, disclose, cleanDocx, extractDocxText, cleanHtml, cleanEmail, checkAts, formatAtsReport } from '../src/index.mjs';
import { crc32, readZip, entryData, writeZip } from '../src/zip.mjs';

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

// --- zip ---------------------------------------------------------------------
function originalEntry(name, data, method = 8) {
  const source = Buffer.from(data);
  const entry = readZip(writeZip([{ name, data: source }]))[0];
  if (method === 8) return entry;
  return { ...entry, method: 0, compressed: source, compressedSize: source.length };
}

eq(crc32(Buffer.from('123456789')), 0xCBF43926, 'CRC-32 standard vector');
const zipInputs = [
  originalEntry('bakery.txt', 'bread and rolls', 0),
  originalEntry('garden.txt', 'basil and mint', 8),
];
const zipRoundTrip = readZip(writeZip(zipInputs));
eq(entryData(zipRoundTrip[0]).toString(), 'bread and rolls', 'zip stored entry round trip');
eq(entryData(zipRoundTrip[1]).toString(), 'basil and mint', 'zip deflate entry round trip');
let randomZipError = false;
try { readZip(Buffer.from([4, 8, 15, 16, 23, 42])); } catch (error) { randomZipError = /not a zip/.test(error.message); }
check(randomZipError, 'random bytes are rejected as a zip');

// --- docx --------------------------------------------------------------------
function docxFixture(documentXml, headerXml = '<w:hdr><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:hdr>', footerXml = '<w:ftr><w:p><w:r><w:t>Footer</w:t></w:r></w:p></w:ftr>') {
  return writeZip([
    originalEntry('[Content_Types].xml', '<Types></Types>'),
    originalEntry('word/document.xml', documentXml),
    originalEntry('word/header1.xml', headerXml),
    originalEntry('word/footer1.xml', footerXml),
    originalEntry('word/media/image1.png', Buffer.from([0, 1, 2, 250, 255]), 0),
  ]);
}

const docXml = '<w:document><w:body><w:p w:rsidR="00AB"><w:r><w:rPr><w:b/></w:rPr><w:t>Bakery ' + EM + ' ' + LDQ + 'open' + RDQ + ZWSP + '</w:t><w:t>A &amp; B</w:t><w:t>' + ZWSP + ' garden</w:t></w:r></w:p></w:body></w:document>';
const headerXml = '<w:hdr><w:p><w:r><w:t>Header ' + EM + ' note</w:t></w:r></w:p></w:hdr>';
const footerXml = '<w:ftr><w:p><w:r><w:t>' + LDQ + 'Footer' + RDQ + '</w:t></w:r></w:p></w:ftr>';
const dirtyDocx = docxFixture(docXml, headerXml, footerXml);
const dirtyEntries = readZip(dirtyDocx);
const cleanedDocx = cleanDocx(dirtyDocx);
check(cleanedDocx.changed, 'DOCX reports changed text');
eq(cleanedDocx.changedParts.join('|'), 'word/document.xml|word/header1.xml|word/footer1.xml', 'DOCX lists changed parts');
const cleanedEntries = readZip(cleanedDocx.buffer);
const cleanedXml = entryData(cleanedEntries.find((entry) => entry.name === 'word/document.xml')).toString();
check(cleanedXml.includes('<w:t>Bakery, "open"</w:t>'), 'DOCX cleans punctuation and invisible text');
check(cleanedXml.includes('<w:rPr><w:b/></w:rPr>') && cleanedXml.includes('<w:p w:rsidR="00AB">'), 'DOCX preserves markup outside text nodes');
check(cleanedXml.includes('<w:t>A &amp; B</w:t>'), 'DOCX preserves XML escaping');
eq(clean(ZWSP + ' garden'), ' garden', 'space-led fixture has expected clean output');
check(cleanedXml.includes('<w:t xml:space="preserve"> garden</w:t>'), 'DOCX adds space preservation for leading whitespace');
const imageBefore = dirtyEntries.find((entry) => entry.name === 'word/media/image1.png').compressed;
const imageAfter = cleanedEntries.find((entry) => entry.name === 'word/media/image1.png').compressed;
check(imageBefore.equals(imageAfter), 'DOCX keeps image compressed bytes exact');
const cleanedHeader = entryData(cleanedEntries.find((entry) => entry.name === 'word/header1.xml')).toString();
const cleanedFooter = entryData(cleanedEntries.find((entry) => entry.name === 'word/footer1.xml')).toString();
check(cleanedHeader.includes('Header, note') && cleanedFooter.includes('"Footer"'), 'DOCX cleans header and footer text');

const cleanBuffer = docxFixture('<w:document><w:body><w:p><w:r><w:t>Clean garden text</w:t></w:r></w:p></w:body></w:document>');
const unchangedDocx = cleanDocx(cleanBuffer);
check(!unchangedDocx.changed && unchangedDocx.buffer === cleanBuffer, 'clean DOCX returns the original buffer object');
const conservativeDocx = cleanDocx(dirtyDocx, { mode: 'conservative' });
const conservativeXml = entryData(readZip(conservativeDocx.buffer).find((entry) => entry.name === 'word/document.xml')).toString();
check(conservativeXml.includes(EM) && conservativeXml.includes('"open"'), 'conservative DOCX keeps em dash and folds quotes');

const extractXml = '<w:document><w:body><w:p><w:r><w:t>Garden</w:t><w:tab/><w:t>tools</w:t></w:r></w:p><w:p><w:r><w:t>Second &lt;bed&gt;</w:t></w:r></w:p><w:tbl></w:tbl><w:txbxContent></w:txbxContent><w:drawing></w:drawing></w:body></w:document>';
const extracted = extractDocxText(docxFixture(extractXml));
eq(extracted.body, 'Garden\ttools\nSecond <bed>\n', 'DOCX extracts paragraphs, tabs, and escaped text');
eq(extracted.headers, 'Header\n', 'DOCX extracts headers separately');
eq(extracted.footers, 'Footer\n', 'DOCX extracts footers separately');
check(extracted.structure.tables === 1 && extracted.structure.textBoxes === 1 && extracted.structure.images === 1, 'DOCX counts document structures');
let missingDocumentError = false;
try { cleanDocx(writeZip([originalEntry('[Content_Types].xml', '<Types></Types>')])); } catch (error) { missingDocumentError = error.message === 'not a .docx file'; }
check(missingDocumentError, 'zip without document XML is rejected as DOCX');

const cliDocxPath = path.join(os.tmpdir(), `ai-text-hygiene-docx-${process.pid}.docx`);
fs.writeFileSync(cliDocxPath, dirtyDocx);
const cliDocxNoWrite = spawnSync(process.execPath, [cliPath, cliDocxPath], { encoding: 'utf8' });
const cliDocxWrite = spawnSync(process.execPath, [cliPath, '--write', cliDocxPath], { encoding: 'utf8' });
const cliDocxStyle = spawnSync(process.execPath, [cliPath, '--style', cliDocxPath], { encoding: 'utf8' });
const cliDocxXml = entryData(readZip(fs.readFileSync(cliDocxPath)).find((entry) => entry.name === 'word/document.xml')).toString();
fs.unlinkSync(cliDocxPath);
check(cliDocxNoWrite.status === 1, 'CLI DOCX without write exits 1');
check(cliDocxWrite.status === 0 && cliDocxXml.includes('Bakery, "open"'), 'CLI DOCX write cleans the file');
check(cliDocxStyle.status === 0 && cliDocxStyle.stdout.startsWith('style:'), 'CLI DOCX style report renders');

// HTML
const TWO_HYPHENS = '-' + '-';
const htmlDirty = '<p title="a' + EM + 'b">' + LDQ + 'Bread' + RDQ + EM + 'fresh</p>';
eq(cleanHtml(htmlDirty), '<p title="a' + EM + 'b">"Bread", fresh</p>', 'HTML cleans text and keeps attributes exact');
eq(cleanHtml('<p>&mdash; &#8212; &nbsp; &amp;</p>'), '<p>, &nbsp; &amp;</p>', 'HTML decodes selected dash entities only');
eq(cleanHtml('<pre>keep ' + EM + '<code>nested ' + LDQ + 'text' + RDQ + '</code></pre>'), '<pre>keep ' + EM + '<code>nested ' + LDQ + 'text' + RDQ + '</code></pre>', 'HTML keeps nested pre and code content');
eq(cleanHtml('<code>keep ' + EM + '</code><p>fold ' + EM + ' now</p>'), '<code>keep ' + EM + '</code><p>fold, now</p>', 'HTML resumes cleaning after code');
eq(cleanHtml('<script>if (a' + TWO_HYPHENS + 'b) x = "' + EM + '";</script>'), '<script>if (a' + TWO_HYPHENS + 'b) x = "' + EM + '";</script>', 'HTML keeps script content exact');
eq(cleanHtml('<!' + TWO_HYPHENS + ' keep ' + EM + ' ' + TWO_HYPHENS + '><p>fold ' + EM + '</p>'), '<!' + TWO_HYPHENS + ' keep ' + EM + ' ' + TWO_HYPHENS + '><p>fold, </p>', 'HTML keeps comments exact');
eq(cleanHtml(cleanHtml(htmlDirty)), cleanHtml(htmlDirty), 'HTML cleaning is idempotent');
eq(cleanHtml('<p>a' + EM + ZWSP + 'b</p>', { mode: 'strip' }), '<p>a' + EM + 'b</p>', 'HTML strip mode keeps dash and removes invisible');
check(cleanHtml(null) === null, 'HTML null passes through');
let badHtmlMode = false;
try { cleanHtml('Bread', { mode: 'bogus' }); } catch (error) { badHtmlMode = error instanceof TypeError; }
check(badHtmlMode, 'HTML unknown mode throws TypeError');

// Email
const emailDraft = 'Subject: ' + LDQ + 'Bread\r\n\tfor today' + RDQ + '\r\nTo: bakery@example.test\r\nX-Note: keep ' + EM + '\r\n\r\nFresh' + EM + 'today\r\n> quoted ' + EM + '\r\nOn Tuesday, the baker wrote:\r\nold ' + EM;
const emailClean = cleanEmail(emailDraft);
check(emailClean.startsWith('Subject: "Bread for today"\r\nTo: bakery@example.test\r\nX-Note: keep ' + EM), 'email cleans and unfolds Subject only');
check(emailClean.includes('\r\n\r\nFresh, today\r\n> quoted ' + EM), 'email cleans body and keeps quoted line');
check(emailClean.endsWith('On Tuesday, the baker wrote:\r\nold ' + EM), 'email keeps reply tail exact');
const signedEmail = 'Garden note ' + EM + '\n' + '-' + '- \nShop ' + EM + ZWSP + '\n555-0104';
eq(cleanEmail(signedEmail), 'Garden note, \n' + '-' + '- \nShop ' + EM + '\n555-0104', 'email signature strips invisibles only');
eq(cleanEmail('Bread ' + EM + ' warm'), 'Bread, warm', 'email draft without headers is cleaned');
eq(cleanEmail('Bread ' + EM + ZWSP + 'warm', { mode: 'strip' }), 'Bread ' + EM + 'warm', 'email strip mode keeps dash and removes invisible');
const mimeEmail = 'Content-Transfer-Encoding: base64\r\nSubject: ' + LDQ + 'Bread' + RDQ + '\r\n\r\nQnJlYWQ=';
eq(cleanEmail(mimeEmail), mimeEmail, 'MIME encoded email is unchanged');
eq(cleanEmail(cleanEmail(emailDraft)), cleanEmail(emailDraft), 'email cleaning is idempotent');
let badEmailMode = false;
try { cleanEmail('Bread', { mode: 'bogus' }); } catch (error) { badEmailMode = error instanceof TypeError; }
check(badEmailMode, 'email unknown mode throws TypeError');

// ATS
const atsClean = checkAts('Bread baker\nGarden helper', { keywords: ['Bread'] });
check(atsClean.ok && atsClean.findings.length === 0, 'ATS clean input has no findings');
check(checkAts('Bread baker\r\nGarden helper\r\n').findings.length === 0, 'ATS does not flag CRLF line endings');
const bigHtml = '<p>Fresh bread ' + EM + ' daily</p>'.repeat(20000);
const bigStart = Date.now();
check(cleanHtml(bigHtml).includes('Fresh bread, daily') && Date.now() - bigStart < 2000, 'cleanHtml stays fast on a large page');
const ltStart = Date.now();
checkAts('<'.repeat(200000), { html: true });
check(Date.now() - ltStart < 2000, 'ATS html tag strip stays fast on a run of unclosed <');
check(checkAts('Bread' + ZWSP).findings.some((f) => f.type === 'invisible'), 'ATS flags invisible characters');
check(!checkAts('Bread' + ZWSP).ok, 'ATS high finding makes ok false');
check(checkAts(C(0xE001)).findings.some((f) => f.type === 'symbol-bullets'), 'ATS flags private-use symbol bullets');
check(checkAts(C(0x25CF) + ' bread').findings.some((f) => f.type === 'fancy-bullets'), 'ATS flags fancy bullets');
check(checkAts('Bread ' + EM + ' warm').findings.some((f) => f.type === 'smart-punctuation'), 'ATS flags smart punctuation');
check(checkAts('Bread    warm\nGarden    tools\nShop    hours').findings.some((f) => f.type === 'columns'), 'ATS flags column-like text');
const keywordReport = checkAts('C++ baking Node' + ZWSP + '.js', { keywords: ['C++', 'Node.js', 'garden'] });
eq(keywordReport.keywords.map((k) => k.status).join('|'), 'found|split|missing', 'ATS keyword found, split, and missing statuses');
check(keywordReport.findings.some((f) => f.type === 'keyword-split') && keywordReport.findings.some((f) => f.type === 'keyword-missing'), 'ATS keyword findings render');
check(checkAts('<p>Bread</p>', { html: true, keywords: ['Bread'] }).keywords[0].status === 'found', 'ATS strips HTML tags for checks');
const atsDocxXml = '<w:document><w:body><w:p><w:r><w:t>Bakery helper</w:t></w:r></w:p><w:txbxContent><w:p><w:r><w:t>Garden</w:t></w:r></w:p></w:txbxContent></w:body></w:document>';
const atsHeaderXml = '<w:hdr><w:p><w:r><w:t>helper@example.test</w:t></w:r></w:p></w:hdr>';
const atsDocx = checkAts(docxFixture(atsDocxXml, atsHeaderXml));
check(atsDocx.findings.some((f) => f.type === 'header-footer-contact'), 'ATS flags contact details only in DOCX header');
check(atsDocx.findings.some((f) => f.type === 'text-box'), 'ATS flags DOCX text boxes');
const atsStructureXml = '<w:document><w:body><w:p><w:r><w:t>Hardware helper</w:t></w:r></w:p><w:tbl></w:tbl><w:drawing></w:drawing></w:body></w:document>';
const atsStructure = checkAts(docxFixture(atsStructureXml));
check(atsStructure.findings.some((f) => f.type === 'tables'), 'ATS flags DOCX tables');
check(atsStructure.findings.some((f) => f.type === 'images'), 'ATS flags DOCX images');
check(formatAtsReport(keywordReport).startsWith('ats:') && formatAtsReport(keywordReport).includes('keywords:'), 'ATS report renders');

// HTML, email, and ATS CLI
const cliHtmlPath = path.join(os.tmpdir(), `ai-text-hygiene-html-${process.pid}.html`);
fs.writeFileSync(cliHtmlPath, '<html><body><p>Bread ' + EM + ' warm</p></body></html>');
const cliHtml = spawnSync(process.execPath, [cliPath, '--write', cliHtmlPath], { encoding: 'utf8' });
const cliHtmlText = fs.readFileSync(cliHtmlPath, 'utf8');
fs.unlinkSync(cliHtmlPath);
check(cliHtml.status === 0 && cliHtmlText.includes('<p>Bread, warm</p>'), 'CLI HTML write cleans text and keeps tags');
const cliEmail = spawnSync(process.execPath, [cliPath, '--email'], { input: 'Bread ' + EM + '\n> keep ' + EM, encoding: 'utf8' });
check(cliEmail.status === 0 && cliEmail.stdout === 'Bread, \n> keep ' + EM, 'CLI email stdin keeps quoted line');
const cliAtsMissing = spawnSync(process.execPath, [cliPath, '--ats', '--keywords=Node.js,baking'], { input: 'Node.js bread', encoding: 'utf8' });
check(cliAtsMissing.status === 2 && cliAtsMissing.stdout.startsWith('ats:'), 'CLI ATS exits 2 for missing keyword');
const cliAtsClean = spawnSync(process.execPath, [cliPath, '--ats', '--keywords=Node.js,baking'], { input: 'Node.js baking', encoding: 'utf8' });
check(cliAtsClean.status === 0 && cliAtsClean.stdout.startsWith('ats: ok'), 'CLI ATS exits 0 when clean and keywords found');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
