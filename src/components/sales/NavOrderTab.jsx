import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowUpDown, Check, ChevronUp, ChevronDown } from 'lucide-react';
import { orderedSections, navOrderOf, isDefaultNavOrder, moveInList } from '../../utils/navPins';
import './NavOrderTab.css';

/**
 * Admin → Side Nav Order (manage_users): the order of the rail's sections and
 * of the pages inside each, for everyone. Lists every page, not just the ones
 * the admin can open, since each person only sees their own. Pins aren't
 * affected — they stay first on each person's Home.
 *
 * `order` / `onSave` come from SalesPage's useNavOrder, the same state the
 * side nav draws from, so a save shows up in the nav straight away.
 */
export default function NavOrderTab({ order, onSave, sidebarToggle }) {
    const saved = useMemo(() => orderedSections(order), [order]);
    const [sections, setSections] = useState(saved);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [justSaved, setJustSaved] = useState(false);

    // A save (here or from another tab) replaces what's on screen.
    useEffect(() => { setSections(saved); }, [saved]);

    const current = navOrderOf(sections);
    const dirty = JSON.stringify(current) !== JSON.stringify(navOrderOf(saved));
    const atDefault = isDefaultNavOrder(current);

    // Leaving the site with unsaved changes asks first.
    useEffect(() => {
        if (!dirty) return undefined;
        const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [dirty]);

    useEffect(() => {
        if (!justSaved) return undefined;
        const t = setTimeout(() => setJustSaved(false), 2500);
        return () => clearTimeout(t);
    }, [justSaved]);

    const edit = (updater) => {
        setJustSaved(false);
        setError('');
        setSections(updater);
    };
    const moveSection = (index, delta) => edit((s) => moveInList(s, index, delta));
    const moveItem = (sectionIndex, index, delta) => edit((s) => s.map((section, i) => (
        i === sectionIndex ? { ...section, items: moveInList(section.items, index, delta) } : section
    )));

    const handleSave = async () => {
        setSaving(true);
        setError('');
        try {
            await onSave(atDefault ? null : current);
            setJustSaved(true);
        } catch (err) {
            setError(err.message || 'Could not save the order');
        } finally {
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
        <div className="nvo-page">
            <div className="nvo-inner">
                <header className="nvo-header">
                    {sidebarToggle}
                    <span className="nvo-header-icon" aria-hidden="true"><ArrowUpDown size={18} /></span>
                    <h1 className="nvo-title">Side Nav Order</h1>
                </header>

                <div className="nvo-bar">
                    <span className="nvo-status" aria-live="polite">
                        {error ? (
                            <span className="nvo-status-error" role="alert"><AlertCircle size={14} aria-hidden="true" />{error}</span>
                        ) : justSaved ? (
                            <span className="nvo-status-ok"><Check size={14} aria-hidden="true" />Saved for everyone</span>
                        ) : dirty ? 'Unsaved changes' : ''}
                    </span>
                    <button
                        type="button"
                        className="nvo-btn nvo-btn-text"
                        onClick={() => edit(() => orderedSections(null))}
                        disabled={saving || atDefault}
                    >
                        Reset to default
                    </button>
                    {dirty && (
                        <button type="button" className="nvo-btn" onClick={() => edit(() => saved)} disabled={saving}>
                            Discard
                        </button>
                    )}
                    <button
                        type="button"
                        className="nvo-btn nvo-btn-primary"
                        onClick={handleSave}
                        disabled={saving || !dirty}
                        aria-busy={saving ? 'true' : undefined}
                    >
                        {saving ? 'Saving…' : 'Save order'}
                    </button>
                </div>

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
            </div>
        </div>
    );
}
