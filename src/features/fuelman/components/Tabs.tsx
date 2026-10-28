import type { KeyboardEvent } from 'react';
// Real tabs: one tab stop, arrow keys move between them, and the selected one is announced.
export default function Tabs<T extends string>({ label, value, items, onChange, className = '' }: {
  label: string; value: T; items: { id: T; label: string }[]; onChange: (id: T) => void; className?: string;
}) {
  const move = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (e.key === 'Home' || e.key === 'End' || step) {
      e.preventDefault();
      const next = items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + step + items.length) % items.length]!;
      onChange(next.id); requestAnimationFrame(() => document.getElementById(`fuel-tab-${next.id}`)?.focus());
    }
  };
  return <div role="tablist" aria-label={label} className={`fuel-tabs ${className}`}>
    {items.map((item, i) => <button key={item.id} id={`fuel-tab-${item.id}`} role="tab" type="button" aria-selected={item.id === value} tabIndex={item.id === value ? 0 : -1}
      className={item.id === value ? 'active' : ''} onClick={() => onChange(item.id)} onKeyDown={e => move(e, i)}>{item.label}</button>)}
  </div>;
}
