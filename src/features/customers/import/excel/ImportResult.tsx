/** The Excel import once applied: created, updated and left alone, any errors, and the rows still needing review. */
import { Check } from 'lucide-react';
import type { ExcelImport } from './useExcelImport';

export default function ImportResult({ x }: { x: ExcelImport }) {
    const result = x.result!;
    return (
        <section className="import-section import-section-done">
            <h3><Check size={18} /> Import finished</h3>
            <div className="import-counts">
                <div className="import-count import-count-create">
                    <strong>{result.results.created}</strong><span>created</span>
                </div>
                <div className="import-count import-count-update">
                    <strong>{result.results.updated}</strong><span>updated</span>
                </div>
                <div className="import-count">
                    <strong>{result.results.skipped}</strong><span>left alone</span>
                </div>
            </div>
            {result.results.errors.length > 0 && (
                <div className="import-error-list">
                    {result.results.errors.map((e: string, i: number) => <div key={i}>{e}</div>)}
                </div>
            )}
            {result.counts.review > 0 && (
                <p className="import-hint">
                    {result.counts.review} row{result.counts.review === 1 ? '' : 's'} still
                    need review — nothing was written for those.{' '}
                    <button className="import-link" onClick={x.downloadReview}>Download the list</button>
                </p>
            )}
        </section>
    );
}
