import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './CustomerProfile.css';

/**
 * A ⋯ menu's scrim and list. On a phone they go to `document.body`: a sheet
 * left inside the tab area ends up under the phone tab bar (z-index 96–98),
 * because some ancestor makes a stacking layer lower than the bar's — however
 * high the sheet's own z-index is. The wrapper gives the portaled part the
 * `.cl .cp` tokens and rules it lost by leaving the profile.
 */
export default function MenuLayer({ sheet, children }: { sheet: boolean; children: ReactNode }) {
    return sheet ? createPortal(<div className="cl cp">{children}</div>, document.body) : <>{children}</>;
}
