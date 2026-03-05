import React, { useState, useEffect, useRef } from 'react';
import { Search, ChevronDown, Check, Plus } from 'lucide-react';

const SearchableSelect = ({ options, value, onChange, placeholder, className, style, onCreateNew, createNewLabel }) => {
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
        document.addEventListener('touchstart', handleOutside, { passive: true }); // iOS fix
        return () => {
            document.removeEventListener('mousedown', handleOutside);
            document.removeEventListener('touchstart', handleOutside);
        };
    }, []);

    // Focus input when opening
    useEffect(() => {
        if (isOpen && inputRef.current) {
            // Small delay on iOS to let the keyboard settle before focusing
            setTimeout(() => inputRef.current?.focus(), 50);
            if (!hasOpenedOnce) setHasOpenedOnce(true);
        } else {
            setSearchTerm('');
        }
    }, [isOpen, hasOpenedOnce]);

    // Only calculate filtered options if dropdown has been opened at least once
    const filteredOptions = React.useMemo(() => {
        if (!hasOpenedOnce) return [];
        return options.filter(option =>
            (option.label || '').toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [options, searchTerm, hasOpenedOnce]);

    const selectedOption = React.useMemo(() => options.find(option => option.value === value), [options, value]);

    const handleSelect = (optionValue, e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        onChange(optionValue);
        setIsOpen(false);
    };

    return (
        <div className={`searchable-select-container ${className || ''}`} ref={dropdownRef} style={{ position: 'relative', ...style }}>
            <div
                className="searchable-select-trigger"
                onClick={() => setIsOpen(!isOpen)}
                onTouchEnd={(e) => { e.preventDefault(); setIsOpen(!isOpen); }}
                style={{
                    padding: '0.5rem',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    minHeight: '38px',
                    color: '#FFF',
                    touchAction: 'manipulation' // Eliminates iOS 300ms click delay
                }}
            >
                <span style={{ color: selectedOption ? '#FFF' : '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedOption ? selectedOption.label : placeholder || 'Select...'}
                </span>
                <ChevronDown size={16} color="#9CA3AF" />
            </div>

            {isOpen && (
                <div
                    className="searchable-select-dropdown"
                    style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        width: '100%',
                        maxHeight: '250px',
                        overflowY: 'auto',
                        backgroundColor: '#1C1C1E',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '4px',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.1)',
                        zIndex: 1000,
                        marginTop: '4px',
                        WebkitOverflowScrolling: 'touch' // Smooth scroll on iOS
                    }}
                >
                    <div className="searchable-select-search" style={{ padding: '8px', position: 'sticky', top: 0, backgroundColor: '#1C1C1E', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                        <div style={{ position: 'relative' }}>
                            <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
                            <input
                                ref={inputRef}
                                type="text"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onTouchEnd={(e) => e.stopPropagation()} // Prevent dropdown close on search tap
                                style={{
                                    width: '100%',
                                    padding: '6px 8px 6px 28px',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    borderRadius: '4px',
                                    fontSize: '16px', // 16px prevents iOS auto-zoom on focus
                                    outline: 'none',
                                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                    color: '#FFF',
                                    touchAction: 'manipulation'
                                }}
                            />
                        </div>
                    </div>

                    {onCreateNew && (
                        <div
                            onClick={(e) => { e.stopPropagation(); setIsOpen(false); onCreateNew(); }}
                            onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); setIsOpen(false); onCreateNew(); }}
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
                            <span>{createNewLabel || '+ New Customer'}</span>
                        </div>
                    )}

                    <div className="searchable-select-options">
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map(option => (
                                <div
                                    key={option.value}
                                    className="searchable-select-option"
                                    onClick={(e) => handleSelect(option.value, e)}
                                    onTouchEnd={(e) => handleSelect(option.value, e)} // iOS fix: fires immediately on touch
                                    style={{
                                        padding: '10px 12px', // Taller tap target for touch
                                        cursor: 'pointer',
                                        fontSize: '0.9rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        backgroundColor: value === option.value ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                                        color: '#FFF',
                                        touchAction: 'manipulation' // Eliminates iOS 300ms delay
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
                </div>
            )}
        </div>
    );
};

export default SearchableSelect;
