// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ContactModal from './ContactModal';

Element.prototype.scrollIntoView = () => {};
const empty = { name: '', phone: '', email: '', role: '', notes: '' };

describe('ContactModal on the form template', () => {
    it('refuses a blank name and saves a filled one', () => {
        const onSave = vi.fn();
        const { rerender } = render(<ContactModal form={empty} onChange={() => {}} isEditing={false} isSaving={false} onSave={onSave} onClose={() => {}} />);
        expect(screen.getByText('Add a contact')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
        expect(onSave).not.toHaveBeenCalled();
        rerender(<ContactModal form={{ ...empty, name: 'Sam' }} onChange={() => {}} isEditing={false} isSaving={false} onSave={onSave} onClose={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
        expect(onSave).toHaveBeenCalledTimes(1);
    });
    it('edit mode keeps Save changes off until something changes', () => {
        const form = { ...empty, name: 'Sam' };
        render(<ContactModal form={form} onChange={() => {}} isEditing isSaving={false} onSave={() => {}} onClose={() => {}} />);
        expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
    });
});
