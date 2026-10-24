import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';
import { noPayments } from '../../utils/dailyReportPayments';
import type { Loose } from '../../types/records';
import type { Figure, Report } from './types';

/**
 * The day sheet's edits, all through one `patch`: a copy of the report, the
 * change, and the copy back into state (`setReport`). Nothing here is a hook —
 * the page makes a fresh set each render, as it always has.
 */
export const sheetEditors = (setReport: Dispatch<SetStateAction<Report | null>>, locked: boolean) => {
  const patch = (fn: (r: Report) => Report) => setReport(prev => (prev ? fn(structuredClone(prev)) : prev));

  /**
   * Records a nil rather than leaving the section unsaid. Without it the only
   * way to state "no money came in" is to type six zeros, so nobody does, and
   * the day stays ambiguous forever.
   */
  const declareNoPayments = () => patch(r => {
    r.payments = noPayments();
    return r;
  });

  /**
   * A line starts empty, not at zero. Pushing 0 would have every new row assert
   * "no slabs" the moment it appears, which is the same blank-reads-as-answered
   * confusion the dashes exist to remove. Wholly empty lines are dropped on save.
   */
  const addTransfer = () => patch(r => { r.transfers.push({ fromTo: '', transferNumber: '', slabs: null, auto: false }); return r; });
  const addContainer = () => patch(r => { r.containers.push({ poNumber: '', material: '', slabs: null }); return r; });

  /**
   * Enter on the last line of a repeating section adds another; backspace on an
   * empty line removes it. Deliberately unadvertised — it rewards the person who
   * fills this in every evening without cluttering the card for everyone else.
   */
  const rowKeys = (listName: 'transfers' | 'containers', index: number, addRow: () => void, isEmpty: boolean) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (locked) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      const target = e.target as HTMLInputElement;
      const cells = [...(target.closest('tbody')?.querySelectorAll<HTMLElement>('.dr-cell:not(:disabled):not([readonly])') || [])];
      const here = cells.indexOf(target);
      const onLastRow = here >= cells.length - 1;
      if (onLastRow) addRow();
      else cells[here + 1]?.focus();
      return;
    }

    if (e.key === 'Backspace' && isEmpty && (e.target as HTMLInputElement).value === '') {
      e.preventDefault();
      patch(r => { r[listName].splice(index, 1); return r; });
    }
  };

  const setPath = (path: string, value: Figure) => patch(r => {
    const keys = path.split('.');
    let node = r as Loose;
    for (let i = 0; i < keys.length - 1; i++) node = node[keys[i]] as Loose;
    node[keys[keys.length - 1]] = value;
    return r;
  });

  return { patch, declareNoPayments, addTransfer, addContainer, rowKeys, setPath };
};

export type SheetEditors = ReturnType<typeof sheetEditors>;
