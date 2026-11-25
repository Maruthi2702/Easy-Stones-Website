import { useEffect, useRef, useState } from 'react';
import { Camera, ChevronRight, FileText, FileX, Image as ImageIcon, Layers } from 'lucide-react';
import FormModal from '../../../components/shared/form/FormModal';
import useIsPhone from '../../../components/shared/form/useIsPhone';
import { receiptFileProblem } from '../../../utils/receiptFile';

type Props = {
  onCamera: () => void;
  onLost: () => void;
  /** Add several receipts at once (Accounting and Admins); absent = no such option. */
  onSeveral?: () => void;
  /** A photo or file was chosen (or dropped). It has not been checked yet. */
  onFile: (file: File) => void;
  onClose: () => void;
};

/**
 * Add receipt, step one: how to add it (owner's design, 2026-11-21, claude.ai
 * artifact "Receipt capture flow"). The round camera opens this — Open Camera,
 * Upload Photo, Upload File, Lost Receipt — as a size-S form (✕, no footer). Each
 * then leads into the same Add receipt form: a camera shot, a picked photo or file
 * arrives as `initialFile`, Lost Receipt opens it on the lost-receipt reason.
 * On a phone (2026-11-24, claude.ai artifact "Add receipt on a phone", option A) the camera is one
 * big gold card and the rest are compact: Photo library and Files side by side, Lost receipt under
 * "No receipt?", Add several under "For accounting". Same handlers, same words on desktop.
 * Desktop also takes a dropped or pasted file. A wrong file type is refused here, in the
 * window, before anything uploads.
 */
export default function AddReceiptChoice({ onCamera, onLost, onSeveral, onFile, onClose }: Props) {
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState('');
  const [over, setOver] = useState(false);
  const isPhone = useIsPhone();

  const take = (file: File | undefined) => {
    if (!file) return;
    const why = receiptFileProblem(file);
    if (why) { setProblem(why); return; }
    onFile(file);
  };

  // Ctrl/⌘+V: a copied screenshot, photo or PDF file goes the same way as a dropped one.
  const takeRef = useRef(take);
  takeRef.current = take;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      const file = files.find((f) => f.type === 'application/pdf' || f.type.startsWith('image/')) ?? files[0];
      if (!file) return;
      e.preventDefault();
      takeRef.current(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  return (
    <FormModal title="Add receipt" size="s" onClose={onClose} hideSubmit hideFooter>
      {isPhone ? (
        <div className="ccr-choice ccr-choice-phone">
          {problem ? <div className="ccr-form-error" role="alert">{problem}</div> : null}

          <button type="button" className="ccr-choice-hero" onClick={onCamera}>
            <span className="ccr-choice-hero-icon"><Camera size={34} aria-hidden="true" /></span>
            <b>Take a photo</b>
            <small>Lay the receipt flat in good light. We read the details for you.</small>
          </button>

          <div className="ccr-choice-pair">
            <button type="button" className="ccr-choice-tile" onClick={() => photoRef.current?.click()}>
              <span className="ccr-choice-icon"><ImageIcon size={22} aria-hidden="true" /></span>
              <span className="ccr-choice-text"><b>Photo library</b><small>Pick a photo</small></span>
            </button>
            <button type="button" className="ccr-choice-tile" onClick={() => fileRef.current?.click()}>
              <span className="ccr-choice-icon"><FileText size={22} aria-hidden="true" /></span>
              <span className="ccr-choice-text"><b>Files</b><small>PDF or image</small></span>
            </button>
          </div>

          <div className="ccr-choice-label">No receipt?</div>
          <button type="button" className="ccr-choice-opt ccr-choice-row" onClick={onLost}>
            <span className="ccr-choice-icon"><FileX size={22} aria-hidden="true" /></span>
            <span className="ccr-choice-text"><b>Lost receipt</b><small>Say why and enter the details</small></span>
            <ChevronRight size={20} className="ccr-choice-chev" aria-hidden="true" />
          </button>

          {onSeveral ? (
            <>
              <div className="ccr-choice-label">For accounting</div>
              <button type="button" className="ccr-choice-opt ccr-choice-row" onClick={onSeveral}>
                <span className="ccr-choice-icon"><Layers size={22} aria-hidden="true" /></span>
                <span className="ccr-choice-text"><b>Add several</b><small>A pile of receipts for one cardholder</small></span>
                <ChevronRight size={20} className="ccr-choice-chev" aria-hidden="true" />
              </button>
            </>
          ) : null}

          <input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
          <input ref={fileRef} type="file" accept="application/pdf,image/*" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      ) : (
      <div className="ccr-choice">
        {problem ? <div className="ccr-form-error" role="alert">{problem}</div> : null}

        <button type="button" className="ccr-choice-opt is-main" onClick={onCamera}>
          <span className="ccr-choice-icon"><Camera size={22} aria-hidden="true" /></span>
          <span className="ccr-choice-text"><b>Open Camera</b><small>Take a photo of the receipt now</small></span>
        </button>
        <button type="button" className="ccr-choice-opt" onClick={() => photoRef.current?.click()}>
          <span className="ccr-choice-icon"><ImageIcon size={22} aria-hidden="true" /></span>
          <span className="ccr-choice-text"><b>Upload Photo</b><small>Pick one from your photo library</small></span>
        </button>
        <button type="button" className="ccr-choice-opt" onClick={() => fileRef.current?.click()}>
          <span className="ccr-choice-icon"><FileText size={22} aria-hidden="true" /></span>
          <span className="ccr-choice-text"><b>Upload File</b><small>A PDF or image from Files</small></span>
        </button>
        <button type="button" className="ccr-choice-opt" onClick={onLost}>
          <span className="ccr-choice-icon"><FileX size={22} aria-hidden="true" /></span>
          <span className="ccr-choice-text"><b>Lost Receipt</b><small>No receipt: say why and enter the details</small></span>
        </button>

        {onSeveral ? (
          <button type="button" className="ccr-choice-opt" onClick={onSeveral}>
            <span className="ccr-choice-icon"><Layers size={22} aria-hidden="true" /></span>
            <span className="ccr-choice-text"><b>Add several</b><small>A pile of receipts for one cardholder, each with its own category</small></span>
          </button>
        ) : null}

        {/* A mouse can drop a file; a phone has no use for the box. */}
        <div className={`ccr-choice-drop${over ? ' is-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}>
          Or drop or paste (Ctrl/⌘+V) a photo or PDF here
        </div>

        <input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={fileRef} type="file" accept="application/pdf,image/*" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      )}
    </FormModal>
  );
}
