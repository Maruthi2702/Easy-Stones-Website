import { editHoldDetails, changeHoldSlabs, swapHoldSlab, extendHold, releaseHold } from '../../../api/holds';
import { longDate, slabCount } from '../../../utils/holdView';
import { cartActions } from '../cartStore';
import DetailsForm from '../forms/DetailsForm';
import ExtendForm from '../forms/ExtendForm';
import ReleaseForm from '../forms/ReleaseForm';
import SwapForm from '../forms/SwapForm';
import AddSlabsForm from '../forms/AddSlabsForm';
import type { AddedSlab, OfferedSlab } from '../forms/AddSlabsForm';
import HoldPrintPreview from '../print/HoldPrintPreview';
import type { CartLine, Hold, HoldLine } from '../types';
import type { FormSave, OpenForm } from './holdPageActions';

type HoldDialogsProps = {
  hold: Hold;
  form: OpenForm | null;
  printing: boolean;
  offered: OfferedSlab[];
  cartLines: CartLine[];
  closeForm: () => void;
  closePrint: () => void;
  formSave: FormSave;
};

/** What opens over the hold page — the print preview and each form — and what each one saves. */
export default function HoldDialogs({ hold, form, printing, offered, cartLines, closeForm, closePrint, formSave }: HoldDialogsProps) {
  return (
    <>
      {printing ? <HoldPrintPreview hold={hold} onClose={closePrint} /> : null}
      {form?.type === 'details' ? (
        <DetailsForm hold={hold} onClose={closeForm} onSave={formSave((patch: object) => editHoldDetails(hold, patch), 'Hold saved')} />
      ) : null}
      {form?.type === 'extend' ? (
        <ExtendForm hold={hold} onClose={closeForm} onSave={formSave((expiresOn: string) => extendHold(hold, expiresOn), (h) => `Held until ${longDate(h.expiresOn)}`)} />
      ) : null}
      {form?.type === 'release' ? (
        <ReleaseForm hold={hold} onClose={closeForm} onRelease={formSave((reason: string) => releaseHold(hold, reason), `Hold #${hold.number} released — its slabs are free`)} />
      ) : null}
      {form?.type === 'swap' ? (
        <SwapForm hold={hold} line={form.line} cartLines={cartLines} onClose={closeForm}
          onSwap={formSave((to: string) => swapHoldSlab(hold, form.line.slabKey, to), (h) => `Swapped ${form.line.serial || form.line.slabKey} for ${h.lines.find((x: HoldLine) => !hold.slabKeys.includes(x.slabKey))?.serial || 'the new slab'}`)} />
      ) : null}
      {form?.type === 'add' ? (
        <AddSlabsForm hold={hold} offered={offered} onClose={closeForm}
          onAdd={formSave(async (add: AddedSlab[]) => { const h = await changeHoldSlabs(hold, { add }); cartActions.load(); return h; }, (h) => `Added ${slabCount(h.lines.length - hold.lines.length)} to Hold #${hold.number}`)} />
      ) : null}
    </>
  );
}
