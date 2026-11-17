import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleHelp, Database, FileText, FlaskConical, Globe2, History, Layers3, LoaderCircle, Pause, Play, Search, Settings2, Sparkles, X, Zap } from 'lucide-react';
import { api } from './api';
import type { Config, DatasetMeta, Run, Sample } from './types';
import { LANGUAGES, LABEL_NAMES, MODEL_NAMES, pct, ms, date, Tag, Modal } from './ui';
import { DatasetPage, RunsPage, Method } from './LabPages';

const active = (run: Run | null) => !!run && ['queued', 'running'].includes(run.status);

function Brand({ small = false }: { small?: boolean }) {
  return <span className={`brand ${small ? 'small' : ''}`}><span className="brand-symbol" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M16 5v22M7 10h18M7 10l-4 9h8l-4-9Zm18 0-4 9h8l-4-9ZM10 27h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span><span>mizan<span className="brand-dot">.</span></span></span>;
}

function ExampleDialog({ close }: { close: () => void }) {
  const [language, setLanguage] = useState('en');
  const examples: Record<string, string> = {
    en: 'All departments must retain approved expense records.',
    ar: 'يجب على جميع الإدارات الاحتفاظ بسجلات المصروفات المعتمدة.',
    mixed: 'يجب على جميع departments الاحتفاظ بـ approved expense records.',
  };
  return <Modal title="One meaning, three expressions" close={close}>
    <p className="dialog-description">Mizan tests whether a model keeps the right policy label when the language changes.</p>
    <div className="reading-switch" role="group" aria-label="Example language">{Object.entries(LANGUAGES).map(([id, name]) => <button key={id} aria-pressed={language === id} onClick={() => setLanguage(id)} lang={id === 'ar' ? 'ar' : undefined}>{name}</button>)}</div>
    <div className="example-clause" key={language}><p dir="auto" lang={language === 'en' ? 'en' : 'ar'}>{examples[language]}</p><Tag label="obligation" /></div>
    <p className="small-note">Original synthetic example. Each variant is evaluated separately; the model never sees the expected label or the paired translations.</p>
  </Modal>;
}

function Comparison({ run }: { run: Run }) {
  return <div className="comparison-list" aria-label="Model accuracy comparison">{run.providers.map((provider, index) => {
    const summary = run.summary[provider];
    return <article className="comparison-row" key={provider}>
      <div className="comparison-model"><span className={`comparison-mark mark-${index % 2}`} aria-hidden="true">{run.mode === 'demo' ? <FlaskConical size={18} /> : provider === 'semif' ? <Zap size={18} /> : <Sparkles size={18} />}</span><div><h3>{MODEL_NAMES[provider] || provider}</h3><span>{run.mode === 'demo' ? 'Illustrative fixture' : provider === 'semif' ? 'Local model' : 'Hosted model'}</span></div></div>
      <div className="comparison-bar" aria-hidden="true"><span style={{ width: `${(summary?.accuracy || 0) * 100}%`, '--bar-color': index % 2 ? '#7f68c7' : '#4865ee' } as CSSProperties} /></div>
      <div className="comparison-value"><strong>{summary?.total ? pct(summary.accuracy) : '—'}</strong><span>{summary?.total ? `${summary.correct} / ${summary.total} correct` : active(run) ? 'Waiting for predictions' : 'Not evaluated'}</span>{!!summary?.error_count && <span className="comparison-errors">{summary.error_count} failed requests</span>}</div>
    </article>;
  })}</div>;
}

function LanguageResults({ run }: { run: Run }) {
  return <section className="language-comparison"><div className="workspace-heading"><h3>Does performance travel across languages?</h3><p>Accuracy is correctness. Agreement asks whether all three variants receive the same prediction.</p></div>
    <div className="language-result-grid">{run.providers.map(provider => {
      const summary = run.summary[provider];
      return <article className="language-result" key={provider}><h3>{MODEL_NAMES[provider] || provider}</h3><div className="language-bars">{Object.entries(LANGUAGES).map(([language, name]) => <div className="bar-row" key={language}><span lang={language === 'ar' ? 'ar' : 'en'}>{name}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${(summary?.per_language?.[language]?.accuracy || 0) * 100}%` }} /></div><strong>{pct(summary?.per_language?.[language]?.accuracy)}</strong></div>)}</div>
        <dl className="language-measures"><div><dt>EN–AR accuracy gap</dt><dd>{summary?.language_gap == null ? '—' : `${(summary.language_gap * 100).toFixed(1)} pp`}</dd></div><div><dt>Triplet agreement</dt><dd>{pct(summary?.consistency)}</dd></div><div><dt>Macro F1</dt><dd>{summary?.macro_f1 == null ? '—' : summary.macro_f1.toFixed(3)}</dd></div></dl>
      </article>;
    })}</div><p className="small-note">Failed requests count as misses. Agreement does not imply correctness. Macro F1 weights all five classes equally.</p>
  </section>;
}

function RunDetails({ run }: { run: Run }) {
  return <section className="run-details-view"><div className="workspace-heading"><h3>The conditions behind this result</h3><p>Model versions, timing and hashes are saved with the export.</p></div>
    <div className="run-detail-models">{run.providers.map(provider => { const summary = run.summary[provider]; return <article key={provider}><h3>{MODEL_NAMES[provider] || provider}</h3><code>{run.models[provider]}</code><dl className="language-measures"><div><dt>Median response</dt><dd>{ms(summary?.p50_latency_ms)}</dd></div><div><dt>p95 response</dt><dd>{ms(summary?.p95_latency_ms)}</dd></div><div><dt>{run.mode === 'demo' ? 'API spend' : 'Estimated API cost'}</dt><dd>{run.mode === 'demo' ? 'No API calls' : summary?.estimated_cost_usd == null ? '—' : `$${summary.estimated_cost_usd.toFixed(5)}`}</dd></div></dl></article>; })}</div>
    <p className="small-note">{run.mode === 'demo' ? 'Fixture scores and timings are illustrative; these are not measurements of SemIf or GPT.' : run.cost_note}</p>
    <div className="protocol-identities"><div><span>Run ID</span><code>{run.id}</code></div><div><span>Dataset version</span><strong>{run.dataset.version}</strong></div><div><span>Dataset hash</span><code>{run.dataset_hash}</code></div><div><span>Prompt hash</span><code>{run.prompt_hash}</code></div></div>
  </section>;
}

function Explorer({ samples, run, meta, mode }: { samples: Sample[]; run: Run | null; meta: DatasetMeta; mode: 'results' | 'dataset' }) {
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState('all');
  const [label, setLabel] = useState('all');
  const [missesOnly, setMissesOnly] = useState(false);
  const [selected, setSelected] = useState<Sample | null>(null);
  const [visibleCount, setVisibleCount] = useState(6);
  useEffect(() => setVisibleCount(6), [query, language, label, missesOnly]);
  const results = run?.results || [];
  const missingPrediction = active(run) ? 'Pending' : 'Not evaluated';
  const datasetRows = mode === 'results' ? samples.filter(s => results.some(r => r.id === s.id)) : samples;
  const filtered = datasetRows.filter(s => (language === 'all' || s.language === language) && (label === 'all' || s.label === label)
    && `${s.id} ${s.text} ${s.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())
    && (!missesOnly || results.some(r => r.id === s.id && (r.error || r.predicted !== r.label))));
  const columns = mode === 'results' ? run?.providers || [] : [];
  const availableLabels = Object.keys(meta.labels).filter(id => samples.some(s => s.label === id));
  return <section className="panel explorer">
    <div className="section-heading"><div><div className="eyebrow subtle">{mode === 'dataset' ? 'THE TEST SET' : 'CLAUSE RESULTS'}</div><h2>{mode === 'dataset' ? 'Browse policy clauses' : 'Inspect the predictions'}</h2></div><span className="count-pill">{filtered.length} clauses</span></div>
    <div className="filter-bar"><label className="search-field"><Search size={17} /><input aria-label="Search policy clauses" placeholder="Search a clause, ID or tag…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label className="select-field"><span className="sr-only">Language</span><select aria-label="Filter by language" value={language} onChange={e => setLanguage(e.target.value)}><option value="all">All languages</option>{Object.entries(LANGUAGES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><ChevronDown size={14} /></label>
    </div><details className="filter-more"><summary>More filters <ChevronDown size={14} /></summary><div className="extra-filters">
      <label className="select-field"><span className="sr-only">Policy class</span><select aria-label="Filter by policy class" value={label} onChange={e => setLabel(e.target.value)}><option value="all">All classes</option>{availableLabels.map(id => <option key={id} value={id}>{LABEL_NAMES[id]}</option>)}</select><ChevronDown size={14} /></label>
      {mode === 'results' && <label className="checkbox-label"><input type="checkbox" checked={missesOnly} onChange={e => setMissesOnly(e.target.checked)} /> Show misses</label>}
    </div></details>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable policy clauses"><table className="clause-table"><thead><tr><th scope="col">Policy clause</th><th scope="col">Language</th><th scope="col">Expected</th>{columns.map(p => <th key={p} scope="col">{MODEL_NAMES[p]}</th>)}<th scope="col"><span className="sr-only">Inspect clause</span></th></tr></thead>
      <tbody>{filtered.slice(0, visibleCount).map(s => <tr key={s.id}><td><div className="clause-id">{s.id} {s.difficulty === 'challenge' && <span>Challenge</span>}</div><p dir="auto" lang={s.language === 'ar' ? 'ar' : undefined}>{s.text}</p></td><td><span className="language-pill" lang={s.language === 'ar' ? 'ar' : 'en'}>{LANGUAGES[s.language]}</span></td><td><Tag label={s.label} /></td>{columns.map(p => {
        const r = results.find(r => r.id === s.id && r.provider === p);
        return <td key={p}><span className={`prediction ${r && (r.error || r.predicted !== s.label) ? 'miss' : ''}`}>{r ? <>{!r.error && r.predicted === s.label && <Check size={13} />}<Tag label={r.error ? null : r.predicted} /></> : missingPrediction}</span></td>;
      })}<td><button className="icon-button inspect-button" aria-label={`Inspect ${s.id}`} onClick={() => setSelected(s)}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table></div>
    {!filtered.length && <div className="empty-state"><Search size={24} /><h3>No clauses match these filters.</h3><p>Try another search or language.</p></div>}
    {filtered.length > 0 && <div className="browse-more"><span>{Math.min(visibleCount, filtered.length)} of {filtered.length} clauses shown</span>{visibleCount < filtered.length && <button className="button secondary" onClick={() => setVisibleCount(count => count + 6)}>Show {Math.min(6, filtered.length - visibleCount)} more clauses <ChevronDown size={14} /></button>}</div>}
    <div className="table-footer"><span><FileText size={14} /> Original synthetic corpus · bilingual review pending</span><span>v{meta.version}</span></div>
    {selected && <Modal title="Inspect policy clause" close={() => setSelected(null)}><div className="inspect-meta"><span className="mono">{selected.pair_id}</span><Tag label={selected.label} /></div><p className="dialog-description">{meta.labels[selected.label]}</p>
      <div className="reading-switch" role="group" aria-label="Clause language">{samples.filter(sample => sample.pair_id === selected.pair_id).map(sample => <button key={sample.id} aria-pressed={sample.id === selected.id} onClick={() => setSelected(sample)} lang={sample.language === 'ar' ? 'ar' : undefined}>{LANGUAGES[sample.language]}</button>)}</div>
      <div className="inspect-variant" key={selected.id}><div className="variant-title"><span>{LANGUAGES[selected.language]}</span><span>{selected.id}</span></div><p dir="auto" lang={selected.language === 'en' ? 'en' : 'ar'}>{selected.text}</p>{mode === 'results' && <div className="variant-results">{columns.map(provider => {
        const result = results.find(item => item.id === selected.id && item.provider === provider);
        return <div key={provider}><span>{MODEL_NAMES[provider] || provider}</span>{result ? <Tag label={result.error ? null : result.predicted} /> : <span>{missingPrediction}</span>}<span>{result ? ms(result.latency_ms) : '—'}</span>{result?.error && <p className="error-text">{result.error}</p>}{result?.probabilities && <details className="probability-details"><summary>Option probabilities <ChevronDown size={14} /></summary><div className="probability-list" aria-label="Conditional option probabilities">{Object.entries(result.probabilities).map(([label, value]) => <span key={label}>{LABEL_NAMES[label]} {pct(value)}</span>)}</div><p className="small-note">Conditional option scores, not calibrated confidence.</p></details>}</div>;
      })}</div>}</div>
    </Modal>}

  </section>;
}

function Matrix({ run }: { run: Run }) {
  const [provider, setProvider] = useState(run.providers[0]);
  const validProvider = run.providers.includes(provider) ? provider : run.providers[0];
  const summary = run.summary[validProvider];
  const labels = Object.keys(LABEL_NAMES);
  return <section className="panel matrix-panel"><div className="section-heading"><div><div className="eyebrow subtle">WHERE LABELS DRIFT</div><h2>Confusion matrix</h2></div><label className="select-field"><select aria-label="Confusion matrix model" value={validProvider} onChange={e => setProvider(e.target.value)}>{run.providers.map(p => <option key={p} value={p}>{MODEL_NAMES[p]}</option>)}</select><ChevronDown size={14} /></label></div><p className="section-note">Rows are expected labels. Columns are predictions. Failed requests have their own column.</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable confusion matrix"><table className="matrix-table"><thead><tr><th scope="col">Expected / predicted</th>{[...labels, 'error'].map(l => <th scope="col" key={l}>{LABEL_NAMES[l] || 'Error'}</th>)}</tr></thead><tbody>{labels.map(l => <tr key={l}><th scope="row">{LABEL_NAMES[l]}</th>{[...labels, 'error'].map(k => <td className={l === k ? 'matrix-diagonal' : ''} key={k}>{summary?.confusion_matrix?.[l]?.[k] || 0}</td>)}</tr>)}</tbody></table></div>
  </section>;
}

function RunDialog({ config, close, onCreated }: { config: Config; close: () => void; onCreated: (run: Run) => void }) {
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  const [selected, setSelected] = useState(['semif', 'openai']);
  const [pairLimit, setPairLimit] = useState(20);
  const [budget, setBudget] = useState(config.default_budget_usd);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const unavailable = mode === 'live' && selected.some(p => !config.providers.find(v => v.id === p)?.configured);
  async function start() {
    setPending(true); setError('');
    try { const run = await api<Run>('/runs', { method: 'POST', body: JSON.stringify({ mode, providers: selected, pair_limit: pairLimit, budget_usd: budget }) }); onCreated(run); }
    catch (e) { setError((e as Error).message); setPending(false); }
  }
  return <Modal title="Start a benchmark" close={close}>
    <p className="dialog-description">One dataset. One rubric. A comparison you can inspect.</p>
    <fieldset className="mode-options"><legend className="field-label">Run mode</legend><label className={mode === 'demo' ? 'chosen' : ''}><input type="radio" name="run-mode" value="demo" checked={mode === 'demo'} onChange={() => setMode('demo')} /><FlaskConical size={18} /><span><strong>Demo fixtures</strong><small>Illustrative results · no API calls</small></span></label><label className={mode === 'live' ? 'chosen' : ''}><input type="radio" name="run-mode" value="live" checked={mode === 'live'} onChange={() => setMode('live')} /><Zap size={18} /><span><strong>Live models</strong><small>Local inference + hosted API</small></span></label></fieldset>
    <fieldset className="provider-options"><legend className="field-label">Models to compare</legend>{config.providers.map((p, i) => <label key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={() => setSelected(s => s.includes(p.id) ? s.filter(v => v !== p.id) : [...s, p.id])} /><span><strong>{mode === 'demo' ? `Demo ${i === 0 ? 'A' : 'B'}` : p.name}</strong><small>{mode === 'demo' ? 'Fixture replay, not a model measurement' : p.model}</small></span><span className={`connection-badge ${p.configured ? 'ready' : ''}`}>{mode === 'demo' ? 'No key needed' : p.id === 'semif' ? 'Local · no key' : p.configured ? 'Key configured' : 'Key needed'}</span></label>)}</fieldset>
    <div className="form-two-columns"><label className="field-label">Dataset size<select value={pairLimit} onChange={e => setPairLimit(Number(e.target.value))}><option value={5}>Quick check · 15 clauses</option><option value={20}>Full starter corpus · 60 clauses</option></select></label><label className="field-label">Budget ceiling (USD)<input type="number" min="0.001" max="5" step="0.01" value={budget} disabled={mode === 'demo'} onChange={e => setBudget(Number(e.target.value))} /></label></div>
    <div className="run-receipt"><span>Planned classifications</span><strong>{pairLimit * 3 * selected.length}</strong></div>
    {unavailable && <p className="form-note">Configure the selected providers in the backend .env, or run the demo.</p>}
    <p className="small-note">{mode === 'demo' ? 'Demo predictions and latency are illustrative fixtures. They say nothing about actual SemIf or GPT performance.' : 'The budget uses a conservative token-cost estimate before execution. Keys remain on the backend.'}</p>
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="modal-actions"><button className="button secondary" onClick={close}>Cancel</button><button className="button primary" disabled={pending || !selected.length || unavailable || !(budget > 0 && budget <= 5)} onClick={start}>{pending ? <LoaderCircle size={16} className="spinning" /> : <Play size={15} />}{pending ? 'Starting…' : mode === 'demo' ? 'Run demo benchmark' : 'Run live benchmark'}</button></div>
  </Modal>;
}

export default function App() {
  const [tab, setTab] = useState('overview');
  const [config, setConfig] = useState<Config | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState('');
  const [runDialog, setRunDialog] = useState(false);
  const [connections, setConnections] = useState(false);
  const [example, setExample] = useState(false);
  const [exploring, setExploring] = useState(false);
  const [resultView, setResultView] = useState('languages');
  const [motionPaused, setMotionPaused] = useState(false);

  async function load() {
    try {
      const [c, d, history] = await Promise.all([api<Config>('/config'), api<{ samples: Sample[] }>('/dataset'), api<Run[]>('/runs')]);
      setConfig(c); setSamples(d.samples); setRuns(history); setError('');
      if (history.length) setRun(await api<Run>(`/runs/${history[0].id}`));
    } catch (e) { setError(`Cannot connect to the benchmark backend. ${(e as Error).message}`); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!active(run)) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try { const updated = await api<Run>(`/runs/${run!.id}`); if (!cancelled) { setRun(updated); if (!active(updated)) setRuns(await api<Run[]>('/runs')); } }
      catch (e) { if (!cancelled) setError((e as Error).message); }
    }, 800);
    return () => { cancelled = true; clearInterval(timer); };
  }, [run?.id, run?.status]);

  const transition = useRef<ReturnType<Document['startViewTransition']> | null>(null);
  function navigate(next: string) {
    if (next === tab) return;
    const update = () => { setTab(next); window.scrollTo({ top: 0, behavior: 'instant' }); };
    transition.current?.skipTransition();
    if (document.startViewTransition && !motionPaused && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      transition.current = document.startViewTransition(() => flushSync(update));
      void transition.current.finished.catch(() => {});
    } else update();
  }
  useEffect(() => {
    document.documentElement.dataset.motion = motionPaused ? 'paused' : 'playing';
    if (motionPaused) transition.current?.skipTransition();
    return () => { delete document.documentElement.dataset.motion; };
  }, [motionPaused]);

  async function selectRun(id: string) {
    setExploring(false); setResultView('languages');
    try { setRun(await api<Run>(`/runs/${id}`)); navigate('overview'); } catch (e) { setError((e as Error).message); }
  }
  async function cancelRun() { if (run) { try { setRun(await api<Run>(`/runs/${run.id}/cancel`, { method: 'POST' })); setRuns(await api<Run[]>('/runs')); } catch (e) { setError((e as Error).message); } } }
  const nav = [{ id: 'overview', name: 'Overview', icon: Layers3 }, { id: 'dataset', name: 'Dataset', icon: Database }, { id: 'runs', name: 'Runs', icon: History }, { id: 'method', name: 'Method', icon: FlaskConical }];
  const title = nav.find(n => n.id === tab)?.name || 'Overview';

  return <div className="app-shell" data-motion={motionPaused ? 'paused' : 'playing'}><a href="#main-content" className="skip-link">Skip to content</a>
    <aside className="sidebar"><button className="brand-button" aria-label="Mizan overview" onClick={() => navigate('overview')}><Brand /></button><div className="sidebar-label">YOUR RESEARCH LAB</div>
      <nav aria-label="Main navigation" style={{ '--nav-index': nav.findIndex(n => n.id === tab) } as CSSProperties}><span className="nav-lens" aria-hidden="true" />{nav.map(n => <button key={n.id} aria-label={n.name} aria-current={tab === n.id ? 'page' : undefined} className={tab === n.id ? 'nav-active' : ''} onClick={() => navigate(n.id)}><n.icon size={19} /><span>{n.name}</span></button>)}</nav>
      <div className="sidebar-lab"><span className="lab-arabic" lang="ar" dir="rtl">ميزان</span><span>Meaning, in balance.</span><div className="lab-language-chips"><span>EN</span><span lang="ar">ع</span><span>MIX</span></div></div>
      <div className="sidebar-bottom"><button onClick={() => setConnections(true)}><Settings2 size={17} /><span>Connections</span><span className="connection-count">{config?.providers.filter(p => p.configured).length || 0}/{config?.providers.length || 0}</span></button><div className="workspace-user"><span className="avatar">PA</span><div><strong>Personal workspace</strong><span>Local research studio</span></div></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><span className="breadcrumb-symbol"><Layers3 size={15} /></span><span>Mizan</span><span className="breadcrumb-slash">/</span><strong>{title}</strong></div><div className="topbar-actions"><button className="icon-button ambient-toggle" aria-label="Pause decorative motion" title={motionPaused ? 'Resume motion' : 'Pause motion'} aria-pressed={motionPaused} onClick={() => setMotionPaused(value => !value)}>{motionPaused ? <Play size={15} /> : <Pause size={15} />}</button><span className="local-status"><span className="status-dot" /> Personal lab</span><button className="icon-button mobile-connections" aria-label="Model connections" onClick={() => setConnections(true)}><Settings2 size={17} /></button><button className="button top-run" disabled={!config || active(run)} onClick={() => setRunDialog(true)}><Play size={14} /> New run</button></div></header>
      <main id="main-content" tabIndex={-1}>
        {error && <div className="error-banner" role="alert"><span>{error}</span><button className="button secondary" onClick={() => void load()}>Retry connection</button></div>}
        {!config && !error && <div className="loading-state"><LoaderCircle className="spinning" size={24} /> Opening your benchmark studio…</div>}
        <div key={tab} className={`page-surface page-${tab}`}>
        {config && tab === 'overview' && <div className="overview-page">
          <section className="overview-intro"><div><div className="eyebrow subtle">ARABIC–ENGLISH POLICY CLASSIFICATION</div><h1>Compare meaning,<br /><span>across languages.</span></h1><p>One dataset. The same task. A comparison you can inspect.</p></div><button className="text-action" onClick={() => setExample(true)}><CircleHelp size={16} /> What are we testing?</button></section>
          {!run && <section className="start-comparison"><span className="start-orbit" aria-hidden="true"><Globe2 size={40} /></span><div><span className="eyebrow subtle">YOUR FIRST EXPERIMENT</span><h2>Start with a simple comparison.</h2><p>Try illustrative fixtures without API calls, or choose local and hosted models.</p><button className="button primary" onClick={() => setRunDialog(true)}>Run a benchmark <ArrowRight size={16} /></button></div></section>}
          {run && <section className="comparison-surface" aria-labelledby="comparison-title">
            <div className="comparison-toolbar"><div><span className="eyebrow subtle">{run.mode === 'demo' ? 'ILLUSTRATIVE COMPARISON' : 'OBSERVED RESULTS'}</span><h2 id="comparison-title">{run.mode === 'demo' ? 'Demo comparison' : 'Model comparison'}</h2></div><div className="snapshot-actions">{runs.length > 0 && <label className="select-field"><select aria-label="Selected benchmark run" value={run.id} onChange={e => void selectRun(e.target.value)}>{!runs.some(r => r.id === run.id) && <option value={run.id}>{run.mode === 'demo' ? 'Demo' : 'Live'} · {run.id}</option>}{runs.map(r => <option key={r.id} value={r.id}>{r.mode === 'demo' ? 'Demo' : 'Live'} · {date(r.created_at)}</option>)}</select><ChevronDown size={14} /></label>}<a className="icon-button" aria-label="Export" title="Export complete run as JSON" href={`/api/runs/${run.id}/export`} download><ArrowDownToLine size={17} /></a></div></div>
            {run.mode === 'demo' && <div className="fixture-note"><FlaskConical size={16} /><p><strong>Demo fixtures.</strong> Illustrative predictions and latency. No model measurements.</p></div>}
            {active(run) && <div className="progress-panel" role="status"><div><LoaderCircle size={17} className="spinning" /><strong>Running benchmark</strong><span>{run.completed} / {run.expected} classifications</span><button onClick={() => void cancelRun()}>Cancel run</button></div><progress value={run.completed} max={run.expected} /></div>}
            {run.status === 'completed_with_errors' && <div className="error-banner" role="status">This run includes provider errors. They are counted as misses; inspect the affected clauses in Predictions.</div>}
            {['failed', 'interrupted', 'cancelled'].includes(run.status) && <div className="error-banner" role="status">Run {run.status}. These are partial results ({run.completed} / {run.expected} classifications). {run.failure}</div>}
            <div className="comparison-axis"><span>Model</span><span>Classification accuracy</span></div><Comparison run={run} />
            <div className="comparison-caption"><span>{run.completed} classifications · {run.mode === 'demo' ? 'fixture replay' : 'live run'} · {run.status.replaceAll('_', ' ')}</span><span>Synthetic corpus · bilingual review pending</span></div>
            <div className="comparison-next"><p>Read the comparison, then follow the evidence.</p><button className="button primary" aria-expanded={exploring} aria-controls="result-workspace" onClick={() => setExploring(value => !value)}>{exploring ? 'Hide results' : 'Explore results'}{exploring ? <X size={15} /> : <ArrowRight size={15} />}</button></div>
          </section>}
          {run && exploring && <section id="result-workspace" className="result-workspace" key={run.id} aria-label="Explore benchmark results">
            <div className="reading-switch result-navigation" role="group" aria-label="Result views">{[['languages', 'Languages'], ['predictions', 'Predictions'], ['errors', 'Label errors'], ['conditions', 'Run details']].map(([id, name]) => <button key={id} aria-pressed={resultView === id} onClick={() => setResultView(id)}>{name}</button>)}</div>
            <div className="result-view" key={resultView}>
              {resultView === 'languages' && <LanguageResults run={run} />}
              {resultView === 'predictions' && <Explorer samples={samples} run={run} meta={config.dataset} mode="results" />}
              {resultView === 'errors' && <Matrix run={run} />}
              {resultView === 'conditions' && <RunDetails run={run} />}
            </div>
          </section>}
          <div className="overview-direction"><span>Looking for the test data?</span><button className="text-action" onClick={() => navigate('dataset')}>Explore the dataset <ArrowRight size={14} /></button></div>
        </div>}
        {config && tab === 'dataset' && <DatasetPage samples={samples} meta={config.dataset} renderExplorer={rows => <Explorer samples={rows} run={null} meta={config.dataset} mode="dataset" />} />}
        {config && tab === 'runs' && <RunsPage runs={runs} running={active(run)} onNew={() => setRunDialog(true)} onSelect={id => void selectRun(id)} />}
        {config && tab === 'method' && <Method config={config} />}
        </div>
        {config && <footer className="footer"><Brand small /><span>Built for careful comparisons.</span><button onClick={() => navigate('method')}><CircleHelp size={14} /> Read the method</button></footer>}
      </main>
    </div>
    {example && <ExampleDialog close={() => setExample(false)} />}
    {runDialog && config && <RunDialog config={config} close={() => setRunDialog(false)} onCreated={r => { setExploring(false); setResultView('languages'); setRun(r); setRuns(old => [r, ...old]); setRunDialog(false); navigate('overview'); }} />}
    {connections && <Modal title="Model connections" close={() => setConnections(false)}><p className="dialog-description">SemIf runs locally without a key. GPT credentials stay on the backend. Configuration is shown here; starting a live run checks the local scorer.</p>{config?.providers.map(p => <div className="connection-row" key={p.id}><span className="model-icon">{p.id === 'semif' ? <Zap size={19} /> : <Sparkles size={19} />}</span><div><strong>{p.name}</strong><span>{p.model}</span></div><span className={`connection-badge ${p.configured ? 'ready' : ''}`}>{p.id === 'semif' ? 'Local · no key' : p.configured ? 'Key configured' : 'Key needed'}</span></div>)}<div className="connection-help"><h3>Local setup</h3><p>Set <code>SEMIF_PYTHON</code> to the Python interpreter in your SemIf environment. <code>make dev</code> starts its local scorer. GPT uses <code>OPENAI_API_KEY</code> or an existing file via <code>OPENAI_ENV_FILE</code>. Restart after changing configuration.</p><p>SemIf needs no Jev account. Demo fixtures work without loading a model.</p></div><div className="modal-actions"><button className="button primary" onClick={() => setConnections(false)}>Done <Check size={16} /></button></div></Modal>}
  </div>;
}
