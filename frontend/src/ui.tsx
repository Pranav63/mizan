import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';

export const LANGUAGES: Record<string, string> = { en: 'English', ar: 'العربية', mixed: 'Mixed' };
export const LABEL_NAMES: Record<string, string> = { obligation: 'Obligation', prohibition: 'Prohibition', permission: 'Permission', definition: 'Definition', procedure: 'Procedure' };
export const MODEL_NAMES: Record<string, string> = { semif: 'SemIf', jev: 'Jev', openai: 'GPT', demo_a: 'Demo A', demo_b: 'Demo B' };
export const pct = (n: number | null | undefined) => n == null ? '—' : `${(n * 100).toFixed(1)}%`;
export const ms = (n: number | null | undefined) => n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`;
export const date = (s: string) => new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function Tag({ label }: { label: string | null }) {
  return <span className={`tag ${label ?? 'error'}`}>{label ? LABEL_NAMES[label] || label : 'Error'}</span>;
}

export function Disclosure({ title, description, badge, group, children }: { title: string; description: string; badge?: string; group?: string; children: ReactNode }) {
  return <details className="disclosure" name={group}><summary><span className="disclosure-copy"><strong>{title}</strong><span>{description}</span></span>{badge && <span className="disclosure-badge">{badge}</span>}<ChevronDown size={18} /></summary><div className="disclosure-body">{children}</div></details>;
}

export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className="modal" aria-labelledby="modal-title" onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === ref.current) { const bounds = ref.current.getBoundingClientRect(); if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) close(); } }}>
    <div className="modal-heading"><div><span className="eyebrow subtle">YOUR BENCHMARK LAB</span><h2 id="modal-title">{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={20} /></button></div>{children}
  </dialog>;
}
