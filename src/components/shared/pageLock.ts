/**
 * Lock the page behind a pop-up, so it can't scroll — on a phone that includes
 * the scroll iOS does when the keyboard opens — and give it back where it was.
 * Shared by FormModal and the Dashboard's Find a customer sheet. More than one
 * pop-up can be open (a form opening another); only the first lock saves and
 * the last unlock restores the page.
 */
let lockCount = 0;
let savedScrollY = 0;

export const lockPage = () => {
    if (lockCount++ > 0) return;
    savedScrollY = window.scrollY;
    const b = document.body.style;
    b.position = 'fixed';
    b.top = `-${savedScrollY}px`;
    b.left = '0';
    b.right = '0';
    b.width = '100%';
    b.overflow = 'hidden';
};

export const unlockPage = () => {
    if (--lockCount > 0) return;
    const b = document.body.style;
    b.position = '';
    b.top = '';
    b.left = '';
    b.right = '';
    b.width = '';
    b.overflow = '';
    window.scrollTo(0, savedScrollY);
};
