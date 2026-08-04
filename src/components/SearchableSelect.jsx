import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check, Plus, Loader } from 'lucide-react';

const SearchableSelect = ({ options, value, onChange, placeholder, className, style, onCreateNew, createNewLabel, isLoading }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [hasOpenedOnce, setHasOpenedOnce] = useState(false);
    const dropdownRef = useRef(null);
    const inputRef = useRef(null);

    // Close dropdown when clicking/touching outside (iPad fix: include touchstart)
    useEffect(() => {
        const handleOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleOutside);
        document.addEventListener('touchstart', handleOutside, { passive: true });
        return () => {
            document.removeEventListener('mousedown', handleOutside);
            document.removeEventListener('touchstart', handleOutside);
        };
    }, []);

    // Focus input when opening
    useEffect(() => {
        if (isOpen && inputRef.current) {
            setTimeout(() => inputRef.current?.focus(), 50);
            if (!hasOpenedOnce) setHasOpenedOnce(true);
        } else {
            setSearchTerm('');
        }
    }, [isOpen, hasOpenedOnce]);

    const filteredOptions = React.useMemo(() => {
        if (!hasOpenedOnce) return [];
        return options.filter(option =>
            (option.label || '').toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [options, searchTerm, hasOpenedOnce]);

    const selectedOption = React.useMemo(() => 
        options.find(option => 
            option.value === value || 
            (option.label && value && option.label.toLowerCase() === value.toString().toLowerCase())
        ), 
        [options, value]
    );

    const handleSelect = (optionValue, e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        onChange(optionValue);
        setIsOpen(false);
    };

    const displayText = selectedOption ? selectedOption.label : (value || placeholder || 'Select...');
    const hasValue = !!(selectedOption || value);

    return (
        <div className={`searchable-select-container ${className || ''}`} ref={dropdownRef} style={{ position: 'relative', ...style }}>
            <div
                className="searchable-select-trigger"
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    padding: '0 0.85rem',
                    border: `1px solid ${isOpen ? 'rgba(212,175,55,0.7)' : 'var(--border-color, rgba(255,255,255,0.12))'}`,
                    borderRadius: '10px',
                    backgroundColor: 'var(--bg-card, #1c1c1e)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                    height: '42px',
                    boxSizing: 'border-box',
                    color: 'var(--text-primary, #fff)',
                    touchAction: 'manipulation',
                    boxShadow: isOpen ? '0 0 0 3px rgba(212,175,55,0.15)' : 'none',
                    transition: 'border-color 0.2s ease, box-shadow 0.2s ease'
                }}
            >
                <span style={{ color: hasValue ? 'var(--text-primary, #fff)' : 'var(--text-muted, #9CA3AF)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.9rem' }}>
                    {displayText}
                </span>
                {isLoading
                    ? <Loader size={14} color="#d4af37" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                    : <ChevronDown size={15} color="#d4af37" style={{ flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }} />
                }
            </div>

            {isOpen && (
                <div
                    className="searchable-select-dropdown"
                    style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        left: 0,
                        width: '100%',
                        maxHeight: '260px',
                        overflowY: 'auto',
                        backgroundColor: '#1c1c1e',
                        border: '1px solid rgba(212, 175, 55, 0.35)',
                        borderRadius: '10px',
                        boxShadow: '0 12px 32px rgba(0,0,0,0.85), 0 0 20px rgba(212,175,55,0.12)',
                        zIndex: 9999,
                        overflow: 'hidden',
                        WebkitOverflowScrolling: 'touch',
                        animation: 'selectPopoverFade 0.15s ease-out'
                    }}
                >
                    {/* Loading state */}
                    {isLoading ? (
                        <div style={{ padding: '16px', textAlign: 'center', color: '#9CA3AF', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                            <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />
                            <span style={{ fontSize: '0.875rem' }}>Loading customers...</span>
                        </div>
                    ) : (
                        <>
                            <div className="searchable-select-search" style={{ padding: '8px', position: 'sticky', top: 0, backgroundColor: '#1c1c1e', borderBottom: '1px solid rgba(255,255,255,0.08)', zIndex: 1 }}>
                                <input
                                        ref={inputRef}
                                        type="text"
                                        placeholder="Search customers..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                        style={{
                                            width: '100%',
                                            padding: '8px 12px',
                                            border: '1px solid rgba(212,175,55,0.3)',
                                            borderRadius: '8px',
                                            fontSize: '0.88rem',
                                            outline: 'none',
                                            backgroundColor: 'rgba(255,255,255,0.05)',
                                            color: '#fff',
                                            touchAction: 'manipulation',
                                            boxSizing: 'border-box',
                                            display: 'block'
                                        }}
                                    />
                            </div>

                            {onCreateNew && (
                                <div
                                    onClick={(e) => { e.stopPropagation(); setIsOpen(false); onCreateNew(); }}
                                    style={{
                                        padding: '10px 12px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        color: '#E5C04A',
                                        fontWeight: 600,
                                        fontSize: '0.9rem',
                                        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                                        position: 'sticky',
                                        top: '46px',
                                        backgroundColor: '#1C1C1E',
                                        zIndex: 1,
                                        touchAction: 'manipulation'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(229, 192, 74, 0.1)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#1C1C1E'}
                                >
                                    <Plus size={16} />
                                    <span>{createNewLabel || 'New Customer'}</span>
                                </div>
                            )}

                            <div className="searchable-select-options">
                                {filteredOptions.length > 0 ? (
                                    filteredOptions.map(option => (
                                        <div
                                            key={option.value}
                                            className="searchable-select-option"
                                            onClick={(e) => handleSelect(option.value, e)}
                                            style={{
                                                padding: '10px 12px',
                                                cursor: 'pointer',
                                                fontSize: '0.9rem',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                backgroundColor: value === option.value ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                                                color: '#FFF',
                                                touchAction: 'manipulation'
                                            }}
                                            onMouseEnter={(e) => {
                                                if (value !== option.value) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                                            }}
                                            onMouseLeave={(e) => {
                                                if (value !== option.value) e.currentTarget.style.backgroundColor = 'transparent';
                                            }}
                                        >
                                            <span>{option.label}</span>
                                            {value === option.value && <Check size={14} color="#10B981" />}
                                        </div>
                                    ))
                                ) : (
                                    <div style={{ padding: '12px', textAlign: 'center', color: '#6B7280', fontSize: '0.875rem' }}>
                                        No results found
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default SearchableSelect;
