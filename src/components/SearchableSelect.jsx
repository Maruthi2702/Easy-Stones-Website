import React, { useState, useEffect, useRef } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';

const SearchableSelect = ({ options, value, onChange, placeholder, className, style }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [hasOpenedOnce, setHasOpenedOnce] = useState(false);
    const dropdownRef = useRef(null);
    const inputRef = useRef(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    // Focus input when opening
    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
            // Mark that dropdown has been opened at least once
            if (!hasOpenedOnce) {
                setHasOpenedOnce(true);
            }
        } else {
            // Reset search when closing (optional, can depend on preference)
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

    const handleSelect = (optionValue) => {
        onChange(optionValue);
        setIsOpen(false);
    };

    return (
        <div className={`searchable-select-container ${className || ''}`} ref={dropdownRef} style={{ position: 'relative', ...style }}>
            <div
                className="searchable-select-trigger"
                onClick={() => setIsOpen(!isOpen)}
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
                    color: '#FFF'
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
                        marginTop: '4px'
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
                                style={{
                                    width: '100%',
                                    padding: '6px 8px 6px 28px',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    borderRadius: '4px',
                                    fontSize: '16px',
                                    outline: 'none',
                                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                    color: '#FFF'
                                }}
                            />
                        </div>
                    </div>

                    <div className="searchable-select-options">
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map(option => (
                                <div
                                    key={option.value}
                                    className="searchable-select-option"
                                    onClick={() => handleSelect(option.value)}
                                    style={{
                                        padding: '8px 12px',
                                        cursor: 'pointer',
                                        fontSize: '0.9rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        backgroundColor: value === option.value ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                                        color: '#FFF'
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
