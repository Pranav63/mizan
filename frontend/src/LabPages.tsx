import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronRight, Database, Fingerprint, FlaskConical, History, ShieldCheck, Sparkles, Workflow, X, Zap } from 'lucide-react';
import type { Config, DatasetMeta, Run, Sample } from './types';
import { Disclosure, Tag, LABEL_NAMES, MODEL_NAMES, pct, date } from './ui';

const classes = [
  { id: 'obligation', hint: 'Required actions', icon: Check },
  { id: 'prohibition', hint: 'Things not allowed', icon: ShieldCheck },
  { id: 'permission', hint: 'What is allowed', icon: Sparkles },
  { id: 'definition', hint: 'What a term means', icon: BookOpen },
  { id: 'procedure', hint: 'Steps to follow', icon: Workflow },
];

export function DatasetPage({ samples, meta, renderExplorer }: { samples: Sample[]; meta: DatasetMeta; renderExplorer: (rows: Sample[]) => ReactNode }) {
  const [selectedClass, setSelectedClass] = useState('obligation');
  const [language, setLanguage] = useState('en');
  const [pairIndex, setPairIndex] = useState(0);
  const [browsing, setBrowsing] = useState(false);
  const classSamples = samples.filter(sample => sample.label === selectedClass);
  const pairs = [...new Set(classSamples.map(sample => sample.pair_id))];
  const pairId = pairs[pairIndex % Math.max(pairs.length, 1)];
  const triplet = classSamples.filter(sample => sample.pair_id === pairId);
  const preview = triplet.find(sample => sample.language === language);

  return <div className="lab-page dataset-page">
    <header className="lab-page-heading"><div><span className="lab-page-eyebrow"><Database size={14} /> POLICY CORPUS</span><h1>Dataset</h1><p>{meta.pair_count} aligned triplets · {meta.sample_count} clauses · five policy classes</p></div><button className={`button ${browsing ? 'secondary' : 'primary'}`} aria-expanded={browsing} aria-controls="dataset-browser" onClick={() => setBrowsing(value => !value)}>{browsing ? 'Close clause browser' : 'Browse all clauses'} {browsing ? <X size={15} /> : <ArrowRight size={15} />}</button></header>

    <section className="dataset-preview" aria-labelledby="dataset-preview-title">
      <div className="dataset-preview-intro"><span className="lab-section-kicker">UNDERSTAND THE INPUT</span><h2 id="dataset-preview-title">One clause, three languages</h2><p>Switch the language. The intended policy class stays the same.</p></div>
      <div className="dataset-class-picker" role="group" aria-label="Preview policy class">{classes.map(({ id, icon: Icon }) => <button key={id} aria-pressed={selectedClass === id} onClick={() => { setSelectedClass(id); setPairIndex(0); }}><Icon size={14} /><span>{LABEL_NAMES[id]}</span></button>)}</div>
      <div className="dataset-specimen">
        <div className="dataset-specimen-heading"><div className="preview-language-switch" role="group" aria-label="Preview language">{[['en', 'English'], ['ar', 'العربية'], ['mixed', 'Mixed']].map(([id, name]) => <button key={id} lang={id === 'ar' ? 'ar' : 'en'} aria-pressed={language === id} onClick={() => setLanguage(id)}>{name}</button>)}</div><Tag label={selectedClass} /></div>
        {preview ? <p key={preview.id} className="dataset-specimen-text" lang={preview.language === 'ar' ? 'ar' : preview.language === 'en' ? 'en' : undefined} dir={preview.language === 'ar' ? 'rtl' : 'auto'}>{preview.text}</p> : <p className="dataset-specimen-text">No clause is available in this variant.</p>}
        <div className="dataset-specimen-footer"><span>{classes.find(item => item.id === selectedClass)?.hint}<span className="specimen-divider">·</span>Clause {pairs.length ? pairIndex % pairs.length + 1 : 0} of {pairs.length}</span><button className="lab-text-button" disabled={pairs.length < 2} onClick={() => setPairIndex(index => index + 1)}>Next clause <ChevronRight size={15} /></button></div>
      </div>
      <p className="lab-boundary-note"><FlaskConical size={14} /> Synthetic starter corpus · bilingual expert review pending</p>
    </section>

    {browsing && <section id="dataset-browser" className="dataset-browser-content" aria-label="Selected policy clauses">{renderExplorer(samples)}</section>}
    <Disclosure title="About this corpus" description="Provenance, translations and review status" badge={`v${meta.version}`}><p className="detail-prose">{meta.provenance} Each triplet contains English, Modern Standard Arabic and mixed-language variants with one intended label. Negation, exceptions and quoted instructions appear in the challenge subset. The labels and translations await bilingual expert review.</p><div className="protocol-identities"><div><span>Dataset version</span><strong>{meta.version}</strong></div><div><span>Dataset hash</span><code>{meta.hash}</code></div></div></Disclosure>
  </div>;
}

export function RunsPage({ runs, running, onNew, onSelect }: { runs: Run[]; running: boolean; onNew: () => void; onSelect: (id: string) => void }) {
  const [mode, setMode] = useState('all');
  const [visibleCount, setVisibleCount] = useState(4);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState('results');
  const runList = useRef<HTMLDivElement>(null);
  const detailPane = useRef<HTMLElement>(null);
  const filtered = runs.filter(run => mode === 'all' || run.mode === mode);
  const selected = filtered.find(run => run.id === selectedId);
  useEffect(() => {
    if (!selectedId || !window.matchMedia('(max-width: 1280px)').matches) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || ['paused', 'off'].includes(document.documentElement.dataset.motion || '');
    detailPane.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'instant' : 'smooth' });
  }, [selectedId]);

  return <div className="lab-page runs-page">
    <header className="lab-page-heading"><div><span className="lab-page-eyebrow"><History size={14} /> EXPERIMENT HISTORY</span><h1>Runs</h1><p>{runs.length} saved · {runs.filter(run => run.mode === 'live').length} live · {runs.filter(run => run.mode === 'demo').length} demo</p></div></header>

    <section className="run-library" aria-label="Your experiments">
      <div className="journal-toolbar"><div className="history-filter" role="group" aria-label="Filter run history">{[['all', 'All runs'], ['live', 'Live models'], ['demo', 'Demo fixtures']].map(([id, name]) => <button key={id} aria-pressed={mode === id} onClick={() => { setMode(id); setVisibleCount(4); setSelectedId(null); }}>{name}</button>)}</div><span className="journal-results-count">{filtered.length} {filtered.length === 1 ? 'experiment' : 'experiments'}</span></div>
      <p className="run-history-boundary">Demo scores are fixture replays, not measurements of actual models.</p>
      <div className={`run-master-detail ${selected ? 'has-selection' : ''}`}>
        <div className="run-history-list">
          {filtered.length > 0 && <div className="run-list" ref={runList} aria-label="Saved runs"><div className="run-list-columns" aria-hidden="true"><span>Run</span><span>Model accuracy</span><span>Status</span></div>{filtered.slice(0, visibleCount).map(run => <button className="run-row" key={run.id} aria-label={`Inspect run ${run.id}`} aria-pressed={selectedId === run.id} aria-controls={selected ? 'selected-run-detail' : undefined} onClick={() => { setSelectedId(run.id); setDetail('results'); }}><span className="run-row-identity"><span className={`run-history-icon ${run.mode}`} aria-hidden="true">{run.mode === 'live' ? <Zap size={17} /> : <FlaskConical size={17} />}</span><span><strong>{run.mode === 'demo' ? 'Demo fixture replay' : 'Live model benchmark'}</strong><span>{date(run.created_at)}</span><code>{run.id}</code></span></span><span className="run-row-scores">{run.providers.map(provider => <span key={provider}><span>{MODEL_NAMES[provider] || provider}</span><strong>{pct(run.summary[provider]?.accuracy)}</strong></span>)}</span><span className="run-row-status"><span className={`run-status ${run.status}`}>{run.status.replaceAll('_', ' ')}</span><ChevronRight size={15} /></span></button>)}</div>}
          {!filtered.length && <div className="journal-empty"><History size={25} /><h2>{mode === 'all' ? 'Your first experiment starts here' : 'No runs in this view'}</h2><p>{mode === 'all' ? 'Run a benchmark to compare predictions and save the conditions behind each score.' : 'Choose another filter or start a new experiment.'}</p><button className="button secondary" disabled={running} onClick={onNew}>Start an experiment <ArrowRight size={15} /></button></div>}
          {filtered.length > 0 && <div className="browse-more"><span>{Math.min(visibleCount, filtered.length)} of {filtered.length} runs shown</span>{visibleCount < filtered.length && <button className="button secondary" onClick={() => setVisibleCount(count => count + 4)}>Show {Math.min(4, filtered.length - visibleCount)} more runs <ChevronDown size={14} /></button>}</div>}
          {!selected && filtered.length > 0 && <p className="run-selection-hint">Select a run to see its results and conditions.</p>}
        </div>

        {selected && <section id="selected-run-detail" className="run-detail-pane" ref={detailPane} aria-label="Selected run details"><div className="run-detail-heading"><div><span className="lab-section-kicker">SELECTED EXPERIMENT</span><h2>{selected.mode === 'demo' ? 'Demo fixture replay' : 'Live model benchmark'}</h2><span>{date(selected.created_at)}</span></div><button className="icon-button" aria-label="Close run details" onClick={() => { runList.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus(); setSelectedId(null); }}><X size={16} /></button></div><div className="run-detail-tabs" role="group" aria-label="Run detail view">{[['results', 'Results'], ['conditions', 'Conditions']].map(([id, name]) => <button key={id} aria-pressed={detail === id} onClick={() => setDetail(id)}>{name}</button>)}</div>
          <div key={`${selected.id}-${detail}`} className="run-detail-content">{detail === 'results' ? <><p className={`journal-mode-note ${selected.mode}`}>{selected.mode === 'demo' ? 'Illustrative fixtures. These scores are not measurements of actual models.' : selected.cost_note}</p><div className="run-provider-grid">{selected.providers.map(provider => <div key={provider}><div><strong>{MODEL_NAMES[provider] || provider}</strong><span>Accuracy</span></div><strong>{pct(selected.summary[provider]?.accuracy)}</strong><small>{selected.summary[provider]?.correct ?? 0} / {selected.summary[provider]?.total ?? 0} correct · {selected.summary[provider]?.error_count ?? 0} failed</small></div>)}</div><p className="journal-completion">{selected.completed} / {selected.expected} classifications · Dataset v{selected.dataset.version}</p></> : <><p className="detail-prose">Saved model versions and hashes identify the conditions of this experiment.</p><div className="protocol-identities">{selected.providers.map(provider => <div key={provider}><span>{MODEL_NAMES[provider] || provider}</span><code>{selected.models[provider] || 'Version not reported'}</code></div>)}<div><span>Dataset hash</span><code>{selected.dataset_hash}</code></div><div><span>Prompt hash</span><code>{selected.prompt_hash}</code></div></div><p className="run-identity">Run ID <code>{selected.id}</code></p></>}{selected.failure && <p className="error-text" role="status">{selected.failure}</p>}</div>
          <div className="run-entry-actions"><button className="button primary" aria-label={`Open run ${selected.id}`} onClick={() => onSelect(selected.id)}>Open full comparison <ArrowUpRight size={15} /></button><a className="button secondary" aria-label={`Export ${selected.id} as CSV`} href={`/api/runs/${selected.id}/export?format=csv`} download><ArrowDownToLine size={15} /> Export CSV</a></div>
        </section>}
      </div>
    </section>
  </div>;
}

const methodChapters = [
  ['overview', 'Overview'], ['dataset', 'Dataset'], ['models', 'Models'], ['scoring', 'Scoring'], ['provenance', 'Provenance'], ['rubric', 'Rubric'], ['sources', 'Sources'],
];

export function Method({ config }: { config: Config }) {
  const [chapter, setChapter] = useState('overview');
  const titles: Record<string, string> = { overview: 'A comparison you can inspect', dataset: 'The dataset', models: 'The model comparison', scoring: 'How scores are calculated', provenance: 'Reproducibility and costs', rubric: 'The classification rubric', sources: 'Sources and next steps' };

  return <div className="lab-page method-page">
    <header className="lab-page-heading"><div><span className="lab-page-eyebrow"><Fingerprint size={14} /> RESEARCH PROTOCOL</span><h1>Method</h1><p>Understand the comparison. Inspect the details when you need them.</p></div></header>
    <div className="method-reader"><nav className="method-chapter-nav" aria-label="Method chapters">{methodChapters.map(([id, title], index) => <button key={id} aria-pressed={chapter === id} aria-controls="method-reading-pane" onClick={() => setChapter(id)}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{title}<ChevronRight size={14} /></button>)}</nav>
      <article id="method-reading-pane" key={chapter} className="method-reading-pane" aria-labelledby="method-chapter-title"><span className="lab-section-kicker">{methodChapters.find((item) => item[0] === chapter)?.[1].toUpperCase()}</span><h2 id="method-chapter-title">{titles[chapter]}</h2>
        {chapter === 'overview' && <><p className="method-lead">Does a classifier keep the same understanding when a policy clause changes language?</p><ol className="method-overview-steps"><li><span>01</span><div><strong>Start with one meaning</strong><p>English, Arabic and mixed-language clauses share an intended policy label.</p></div></li><li><span>02</span><div><strong>Ask each model separately</strong><p>Each model receives one clause, the same task and the same class definitions.</p></div></li><li><span>03</span><div><strong>Check correctness and agreement</strong><p>Measure whether the label is right, and whether predictions match across languages.</p></div></li></ol><p className="method-overview-next">Choose a chapter to inspect the inputs, scoring or saved conditions.</p></>}
        {chapter === 'dataset' && <><p className="detail-prose">Each source clause has English, Modern Standard Arabic and mixed-language versions, with the same intended label. We test translation consistency and correctness separately.</p><p className="method-stat">{config.dataset.pair_count} triplets · {config.dataset.sample_count} clauses · {Object.keys(config.dataset.labels).length} classes</p><p className="small-note">Synthetic starter corpus · bilingual expert review pending.</p></>}
        {chapter === 'models' && <><p className="detail-prose">SemIf scores option logits locally with Qwen3.5-4B. GPT returns a strict JSON label. Both receive the same task instructions and class definitions; their prompt wrappers differ. Each sees only the clause being classified.</p><div className="protocol-boundary"><ShieldCheck size={19} /><p>No ground-truth labels or translated counterparts are sent to either provider.</p></div></>}
        {chapter === 'scoring' && <><dl className="scoring-principles"><div><dt>Accuracy</dt><dd><strong>Correct / all requests</strong><p>Failed requests count as misses.</p></dd></div><div><dt>Macro F1</dt><dd><strong>Five classes, equal weight</strong><p>Average of the per-class F1 scores.</p></dd></div><div><dt>Language agreement</dt><dd><strong>Three matching predictions</strong><p>All must succeed. Agreement does not imply correctness.</p></dd></div></dl><p className="small-note">Language accuracy and the EN–AR gap are measured separately.</p></>}
        {chapter === 'provenance' && <><p className="detail-prose">Runs retain the dataset hash, prompt hash, requested and returned model versions, per-clause predictions, token usage and rates. Latency uses sequential calls with no automatic retries.</p><p className="detail-prose">Local timings use a warm resident model on this Mac. GPT timings include network and hosted inference. SemIf has no API fee; hardware and electricity are excluded. Failed hosted calls may have unreported billable usage. Option probabilities are uncalibrated.</p><div className="protocol-identities"><div><span>Current dataset hash</span><code>{config.dataset.hash}</code></div><div><span>Current prompt hash</span><code>{config.dataset.prompt_hash}</code></div></div></>}
        {chapter === 'rubric' && <div className="rubric-list">{Object.entries(config.dataset.labels).map(([id, description]) => <div key={id}><Tag label={id} /><p>{description}</p></div>)}</div>}
        {chapter === 'sources' && <><p className="detail-prose">Small samples, one prompt and one run cannot establish a universal model ranking. Bilingual review, repeated runs and a held-out corpus are the next research steps.</p><div className="source-links"><a href="https://github.com/TheoLeeCJ/SemIf" target="_blank" rel="noreferrer">SemIf source & method <ArrowUpRight size={14} /></a><a href="https://developers.openai.com/api/docs/guides/structured-outputs" target="_blank" rel="noreferrer">GPT structured outputs <ArrowUpRight size={14} /></a></div></>}
        <p className="method-reader-boundary"><FlaskConical size={15} /><span>Synthetic starter corpus · bilingual expert review pending. Results describe this workload.</span></p>
      </article>
    </div>
  </div>;
}
