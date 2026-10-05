import { createContext } from 'react';

/*
 * The open form's own element (FormModal's <form class="fm-dialog">), for
 * anything that has to paint above the form's footer — a FormSheet on phones.
 *
 * Rendered where it's declared, a sheet sits inside .fm-body, and on iOS
 * Safari a scrolling element (-webkit-overflow-scrolling: touch) is its own
 * stacking context: the sheet's z-index then only counts inside the body and
 * the footer (z-index 2, a sibling of the body) paints over it. Portaled into
 * the form itself, the sheet and the footer share one stacking context, so
 * the sheet's z-index wins — and it stays inside the <form>, so its inputs
 * still belong to it. null outside a FormModal (render in place).
 */
export const FormLayerContext = createContext(null);
