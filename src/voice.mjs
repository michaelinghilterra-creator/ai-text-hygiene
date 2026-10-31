// voice.mjs compares a draft with the user's own writing. It is a
// writing-quality signal that helps the user keep their own voice, not a
// detector and not an evasion tool. It flags differences and never rewrites.

import { AI_WORDS_HIGH, AI_WORDS_LOW, AI_PHRASES } from './style.mjs';

const TOLERANCES = {
  sentenceLength: 8,
  sentenceSpread: 6,
  contractions: 3,
  firstPerson: 4,
  wordLength: 1,
  commas: 1,
  questions: 0.15,
  exclamations: 0.15,
};

const LABELS = {
  sentenceLength: 'average sentence length (words)',
  sentenceSpread: 'sentence length spread (words)',
  contractions: 'contractions per 100 words',
  firstPerson: 'first-person words per 100 words',
  wordLength: 'average word length (letters)',
  commas: 'commas per sentence',
  questions: 'share of sentences that are questions',
  exclamations: 'share of sentences ending in !',
};

const FEATURE_NAMES = Object.keys(TOLERANCES);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordsRe = (list) => new RegExp('\\b(?:' + list.map(esc).join('|') + ')\\b', 'gi');
const phraseRe = (list) => new RegExp('\\b(?:' + list.map((p) => p.split(/\s+/).map(esc).join('\\s+')).join('|') + ')\\b', 'gi');
const RE_AI_HIGH = wordsRe(AI_WORDS_HIGH);
const RE_AI_LOW = wordsRe(AI_WORDS_LOW);
const RE_AI_PHRASE = phraseRe(AI_PHRASES);
const RE_CONTRACTION = /\b[A-Za-z]+'(?:s|t|re|ve|ll|d|m)\b/gi;
const RE_FIRST_PERSON = /\b(?:i|me|my|mine|myself|i'm|i've|i'll|i'd)\b/gi;
const RE_UNCONTRACTED = /\b(?:do not|does not|did not|is not|are not|was not|cannot|can not|will not|would not|it is|that is|I am|I have|we are|you are|they are)\b/i;

function normalize(text) {
  const s = String(text == null ? '' : text);
  return s
    .split(String.fromCharCode(0x2018)).join("'")
    .split(String.fromCharCode(0x2019)).join("'")
    .split(String.fromCharCode(0x201C)).join('"')
    .split(String.fromCharCode(0x201D)).join('"');
}

function words(text) {
  return String(text).match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) || [];
}

function sentences(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const clean = line.replace(/^\s*(?:(?:[-*+])|(?:\d+[.)]))\s*/, '').trim();
    if (!clean) continue;
    for (const piece of clean.split(/(?<=[.!?])\s+(?=["'(A-Z0-9])/)) {
      if (piece.trim()) out.push(piece.trim());
    }
  }
  return out;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function spread(values) {
  const average = mean(values);
  return values.length ? Math.sqrt(mean(values.map((value) => (value - average) ** 2))) : 0;
}

function measure(text) {
  const textWords = words(text);
  const textSentences = sentences(text);
  const lengths = textSentences.map((sentence) => words(sentence).length);
  const per100 = (count) => textWords.length ? count * 100 / textWords.length : 0;
  return {
    words: textWords,
    sentences: textSentences,
    values: {
      sentenceLength: mean(lengths),
      sentenceSpread: spread(lengths),
      contractions: per100((text.match(RE_CONTRACTION) || []).length),
      firstPerson: per100((text.match(RE_FIRST_PERSON) || []).length),
      wordLength: mean(textWords.map((word) => word.length)),
      commas: textSentences.length ? (text.match(/,/g) || []).length / textSentences.length : 0,
      questions: textSentences.length ? textSentences.filter((sentence) => sentence.endsWith('?')).length / textSentences.length : 0,
      exclamations: textSentences.length ? textSentences.filter((sentence) => sentence.endsWith('!')).length / textSentences.length : 0,
    },
    lengths,
  };
}

const round1 = (value) => Math.round(value * 10) / 10;
const round2 = (value) => Math.round(value * 100) / 100;
const uniq = (values) => [...new Set(values)];

function terms(text, re) {
  return uniq((text.match(re) || []).map((term) => term.toLowerCase().replace(/\s+/g, ' ')));
}

function featureMessage(name, yours, draft) {
  if (name === 'sentenceLength') return `Your sentences average ${yours.toFixed(1)} words; this draft averages ${draft.toFixed(1)}.`;
  if (name === 'sentenceSpread') return `Your sentence lengths vary by ${yours.toFixed(1)} words; this draft varies by ${draft.toFixed(1)}.`;
  if (name === 'contractions') return `You use ${yours.toFixed(1)} contractions per 100 words; this draft uses ${draft.toFixed(1)}.`;
  if (name === 'firstPerson') return `You use ${yours.toFixed(1)} first-person words per 100 words; this draft uses ${draft.toFixed(1)}.`;
  if (name === 'wordLength') return `Your words average ${yours.toFixed(1)} characters; this draft averages ${draft.toFixed(1)}.`;
  if (name === 'commas') return `You average ${yours.toFixed(1)} commas per sentence; this draft averages ${draft.toFixed(1)}.`;
  if (name === 'questions') return `Questions make up ${Math.round(yours * 100)}% of your sentences; they make up ${Math.round(draft * 100)}% of this draft.`;
  return `Exclamations make up ${Math.round(yours * 100)}% of your sentences; they make up ${Math.round(draft * 100)}% of this draft.`;
}

function insufficient(draftWords, sampleWords, minDraftWords, minSampleWords) {
  let reason;
  if (sampleWords < minSampleWords && draftWords < minDraftWords) {
    reason = `Your samples are too short (${sampleWords} words) and the draft is too short (${draftWords} words).`;
  } else if (sampleWords < minSampleWords) {
    reason = `Your samples are too short (${sampleWords} words; the draft has ${draftWords} words).`;
  } else {
    reason = `The draft is too short (${draftWords} words; your samples have ${sampleWords} words).`;
  }
  return { score: null, insufficient: true, reason, features: [], flags: [], sentences: [], metrics: { draftWords, sampleWords } };
}

export function analyzeVoice(draft, samples, opts = {}) {
  const draftText = normalize(draft);
  const sampleText = normalize(Array.isArray(samples) ? samples.join('\n\n') : samples);
  const draftData = measure(draftText);
  const sampleData = measure(sampleText);
  const draftWords = draftData.words.length;
  const sampleWords = sampleData.words.length;
  const minDraftWords = opts.minDraftWords ?? 30;
  const minSampleWords = opts.minSampleWords ?? 150;
  if (sampleWords < minSampleWords || draftWords < minDraftWords) {
    return insufficient(draftWords, sampleWords, minDraftWords, minSampleWords);
  }

  const features = FEATURE_NAMES.map((name) => ({
    name,
    label: LABELS[name],
    draft: name === 'questions' || name === 'exclamations' ? round2(draftData.values[name]) : round1(draftData.values[name]),
    yours: name === 'questions' || name === 'exclamations' ? round2(sampleData.values[name]) : round1(sampleData.values[name]),
    similarity: round2(Math.max(0, 1 - Math.abs(draftData.values[name] - sampleData.values[name]) / TOLERANCES[name])),
  }));

  const highDraft = [...terms(draftText, RE_AI_HIGH), ...terms(draftText, RE_AI_PHRASE)];
  const highSamples = new Set([...terms(sampleText, RE_AI_HIGH), ...terms(sampleText, RE_AI_PHRASE)]);
  const lowDraft = terms(draftText, RE_AI_LOW);
  const lowSamples = new Set(terms(sampleText, RE_AI_LOW));
  const highTerms = uniq(highDraft).filter((term) => !highSamples.has(term));
  const lowTerms = lowDraft.filter((term) => !lowSamples.has(term));
  const vocabPenalty = Math.min(30, highTerms.length * 5 + lowTerms.length * 2);
  const averageSimilarity = mean(features.map((feature) => feature.similarity));
  const score = Math.max(0, Math.min(100, Math.round(100 * averageSimilarity) - vocabPenalty));

  const flags = [];
  for (const feature of features) {
    if (feature.similarity < 0.5) {
      flags.push({
        type: 'feature',
        severity: feature.similarity === 0 ? 'high' : 'medium',
        message: featureMessage(feature.name, feature.yours, feature.draft),
      });
    }
  }
  for (const term of highTerms) flags.push({ type: 'vocab', severity: 'high', message: `"${term}" never appears in your samples.` });
  for (const term of lowTerms) flags.push({ type: 'vocab', severity: 'low', message: `"${term}" never appears in your samples.` });

  const usualSpread = Math.max(3, sampleData.values.sentenceSpread);
  const usualLow = Math.round(Math.max(1, sampleData.values.sentenceLength - usualSpread));
  const usualHigh = Math.round(sampleData.values.sentenceLength + usualSpread);
  const flaggedTerms = [...highTerms, ...lowTerms];
  const sentenceReports = draftData.sentences.map((text, index) => {
    const reasons = [];
    const count = draftData.lengths[index];
    if (count > sampleData.values.sentenceLength + 2 * usualSpread) {
      reasons.push(`longer than you usually write (${count} words; yours mostly run ${usualLow} to ${usualHigh})`);
    } else if (count >= 4 && count < Math.max(1, sampleData.values.sentenceLength - 2 * usualSpread)) {
      reasons.push(`shorter than you usually write (${count} words; yours mostly run ${usualLow} to ${usualHigh})`);
    }
    for (const term of flaggedTerms) {
      const re = term.includes(' ') ? phraseRe([term]) : wordsRe([term]);
      if (re.test(text)) reasons.push(`uses "${term}", which never appears in your samples`);
    }
    if (sampleData.values.contractions >= 2) {
      const match = text.match(RE_UNCONTRACTED);
      if (match) reasons.push(`you usually contract "${match[0]}"`);
    }
    return { index, text, reasons };
  }).filter((item) => item.reasons.length);
  sentenceReports.sort((a, b) => b.reasons.length - a.reasons.length || a.index - b.index);

  return {
    score,
    insufficient: false,
    features,
    flags,
    sentences: sentenceReports.slice(0, opts.maxSentences ?? 5),
    metrics: { draftWords, sampleWords, draftSentences: draftData.sentences.length, sampleSentences: sampleData.sentences.length },
  };
}

export function formatVoiceReport(report) {
  if (!report) return '';
  if (report.insufficient) return `voice: insufficient (${report.reason})`;
  const lines = [`voice: ${report.score}/100 (match to your samples)`];
  for (const flag of report.flags) lines.push(`  [${flag.severity}] ${flag.message}`);
  if (report.sentences.length) {
    lines.push('Sentences to rewrite in your own words:');
    for (const sentence of report.sentences) {
      const text = sentence.text.length > 80 ? sentence.text.slice(0, 77) + '...' : sentence.text;
      lines.push(`  ${sentence.index + 1}. "${text}"`);
      for (const reason of sentence.reasons) lines.push(`     ${reason}`);
    }
  }
  if (!report.flags.length && !report.sentences.length) lines.push('  The draft reads like your samples.');
  return lines.join('\n');
}
