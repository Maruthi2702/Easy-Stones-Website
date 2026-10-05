import React, { useMemo, useState } from 'react';
import { AlertCircle, ChevronUp, ChevronDown } from 'lucide-react';
import FormModal from '../shared/form/FormModal';
import { orderedSections, navOrderOf, isDefaultNavOrder, moveInList } from '../../utils/navPins';
import './NavOrderForm.css';

/**
 * "Side nav order" (account menu → admins with manage_users): the order of
 * the rail's sections and of the pages inside each, for everyone. Lists every
 * page, not just the ones the admin can open, since each person only sees
 * their own. Pins aren't affected — they stay first on each person's Home.
 */
export default function NavOrderForm({ order, onSave, onClose }) {
    const initial = useMemo(() => orderedSections(order), [order]);
    const [sections, setSections] = useState(initial);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');

    const current = navOrderOf(sections);
    const dirty = JSON.stringify(current) !== JSON.stringify(navOrderOf(initial));
    const atDefault = isDefaultNavOrder(current);

    const moveSection = (index, delta) => setSections((s) => moveInList(s, index, delta));
    const moveItem = (sectionIndex, index, delta) => setSections((s) => s.map((section, i) => (
        i === sectionIndex ? { ...section, items: moveInList(section.items, index, delta) } : section
    )));

    const handleSubmit = async () => {
        setSaving(true);
        setFormError('');
        try {
            await onSave(atDefault ? null : current);
            onClose();
        } catch (err) {
            setFormError(err.message || 'Could not save the order');
            setSaving(false);
        }
    };

    const arrows = (label, index, length, onMove) => (
        <span className="nvo-arrows">
            <button
                type="button"
                className="nvo-arrow"
                onClick={() => onMove(index, -1)}
                disabled={saving || index === 0}
                aria-label={`Move ${label} up`}
                title="Move up"
            >
                <ChevronUp size={18} />
            </button>
            <button
                type="button"
                className="nvo-arrow"
                onClick={() => onMove(index, 1)}
                disabled={saving || index === length - 1}
                aria-label={`Move ${label} down`}
                title="Move down"
            >
                <ChevronDown size={18} />
            </button>
        </span>
    );

    return (
        <FormModal
            title="Side nav order"
            size="s"
            onClose={onClose}
            onSubmit={handleSubmit}
            submitLabel="Save order"
            saving={saving}
            submitDisabled={!dirty}
            dirtyCount={dirty ? 1 : 0}
            footerStart={(
                <button
                    type="button"
                    className="fm-btn nvo-reset"
                    onClick={() => setSections(orderedSections(null))}
                    disabled={saving || atDefault}
                >
                    Reset to default
                </button>
            )}
            footerNote={formError ? (
                <span className="fm-error" role="alert"><AlertCircle size={13} aria-hidden="true" />{formError}</span>
            ) : null}
        >
            <ol className="nvo-sections">
                {sections.map((section, sectionIndex) => (
                    <li key={section.id} className="nvo-section">
                        <div className="nvo-section-head">
                            <span className="nvo-num" aria-hidden="true">{sectionIndex + 1}</span>
                            <span className="nvo-section-name">{section.label}</span>
                            {arrows(section.label, sectionIndex, sections.length, moveSection)}
                        </div>
                        <ol className="nvo-items">
                            {section.items.map((item, index) => (
                                <li key={item.id} className="nvo-item">
                                    <span className="nvo-item-num" aria-hidden="true">{index + 1}</span>
                                    <span className="nvo-item-name">{item.label}</span>
                                    {section.items.length > 1 && arrows(item.label, index, section.items.length, (i, d) => moveItem(sectionIndex, i, d))}
                                </li>
                            ))}
                        </ol>
                    </li>
                ))}
            </ol>
        </FormModal>
    );
}
