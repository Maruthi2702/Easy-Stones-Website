import React from 'react';

/**
 * One block of the daily report — the five the spreadsheet has, and any that
 * follow. A card with a heading and a source badge saying where its figures
 * came from, so nobody has to guess which numbers the system filled in.
 */
const ReportSection = ({
  title,
  icon: Icon,
  source,                 // { kind: 'auto' | 'typed', label: string }
  children,
  footnote,
  action                  // optional node in the header, e.g. "+ Add line"
}) => (
  <section className="dr-card">
    <header className="dr-card-head">
      {Icon && <Icon size={14} className="dr-card-icon" />}
      <h4>{title}</h4>
      {source && (
        <span className={`dr-source dr-source--${source.kind}`}>{source.label}</span>
      )}
      {action}
    </header>

    <div className="dr-card-body">{children}</div>

    {footnote && <p className="dr-footnote">{footnote}</p>}
  </section>
);

export default ReportSection;
