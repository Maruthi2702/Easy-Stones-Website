import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Clock, ChevronDown } from 'lucide-react';
import CustomDatePicker from './CustomDatePicker';

const GoogleStyleDateTimePicker = ({ value, onChange, required }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    // Parse the incoming ISO string
    const dateObj = value
        ? (value.endsWith('Z') ? new Date(value.slice(0, -1)) : new Date(value))
        : new Date();

    // Auto-initialize empty value with current local time (rounded to 5 mins) on mount
    useEffect(() => {
        if (!value) {
            const newDate = new Date();
            let roundedMin = Math.round(newDate.getMinutes() / 5) * 5;
            if (roundedMin >= 60) {
                newDate.setHours(newDate.getHours() + 1);
                roundedMin = 0;
            }
            newDate.setMinutes(roundedMin);
            newDate.setSeconds(0);
            newDate.setMilliseconds(0);
            
            const pad = (n) => String(n).padStart(2, '0');
            const localISO = `${newDate.getFullYear()}-${pad(newDate.getMonth() + 1)}-${pad(newDate.getDate())}T${pad(newDate.getHours())}:${pad(newDate.getMinutes())}:${pad(newDate.getSeconds())}.000`;
            
            onChange(localISO);
        }
    }, [value, onChange]);

    // Format Display Time: "10:30 AM"
    const displayTime = dateObj.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });

    const currentHour24 = dateObj.getHours();
    const currentMin = dateObj.getMinutes();
    
    const currentHour12 = currentHour24 % 12 === 0 ? 12 : currentHour24 % 12;
    const currentPeriod = currentHour24 >= 12 ? 'PM' : 'AM';
    const roundedMin = Math.round(currentMin / 5) * 5 % 60;

    // Helper to get YYYY-MM-DD (Local)
    const getFormattedDateStr = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const hours = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
    const minutes = useMemo(() => Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0')), []);
    const periods = useMemo(() => ['AM', 'PM'], []);

    const hourRefs = useRef([]);
    const minRefs = useRef([]);
    const periodRefs = useRef([]);

    // Auto-scroll selected values into view when dropdown opens
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => {
                const hourIdx = currentHour12 - 1;
                if (hourRefs.current[hourIdx]) {
                    hourRefs.current[hourIdx].scrollIntoView({ block: 'nearest', behavior: 'auto' });
                }

                const minIdx = Math.floor(roundedMin / 5);
                if (minRefs.current[minIdx]) {
                    minRefs.current[minIdx].scrollIntoView({ block: 'nearest', behavior: 'auto' });
                }

                const periodIdx = currentPeriod === 'AM' ? 0 : 1;
                if (periodRefs.current[periodIdx]) {
                    periodRefs.current[periodIdx].scrollIntoView({ block: 'nearest', behavior: 'auto' });
                }
            }, 50);
        }
    }, [isOpen, currentHour12, roundedMin, currentPeriod]);

    // Handle Outside Click
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const emitChange = (h12, minVal, pmAm) => {
        let h24 = Number(h12) % 12;
        if (pmAm === 'PM') {
            h24 += 12;
        }

        const newDate = new Date(dateObj);
        newDate.setHours(h24);
        newDate.setMinutes(Number(minVal));
        newDate.setSeconds(0);
        newDate.setMilliseconds(0);

        const pad = (n) => String(n).padStart(2, '0');
        const localISO = `${newDate.getFullYear()}-${pad(newDate.getMonth() + 1)}-${pad(newDate.getDate())}T${pad(newDate.getHours())}:${pad(newDate.getMinutes())}:${pad(newDate.getSeconds())}.000`;

        onChange(localISO);
    };

    const handleDateChange = (newDateStr) => {
        if (!newDateStr) return;
        const [year, month, day] = newDateStr.split('-').map(Number);

        const newDate = new Date(dateObj);
        newDate.setFullYear(year);
        newDate.setMonth(month - 1);
        newDate.setDate(day);

        const pad = (n) => String(n).padStart(2, '0');
        const localISO = `${newDate.getFullYear()}-${pad(newDate.getMonth() + 1)}-${pad(newDate.getDate())}T${pad(newDate.getHours())}:${pad(newDate.getMinutes())}:${pad(newDate.getSeconds())}.000`;

        onChange(localISO);
    };

    return (
        <div className="google-style-picker">
            <div className="picker-row">
                {/* Custom Date Picker */}
                <div className="picker-input-wrapper">
                    <CustomDatePicker
                        value={getFormattedDateStr(dateObj)}
                        onChange={handleDateChange}
                        required={required}
                    />
                </div>

                <span className="picker-separator">at</span>

                {/* Time Selector */}
                <div className="picker-input-wrapper time-picker-wrapper" ref={dropdownRef}>
                    <div className={`picker-button time-button ${isOpen ? 'active' : ''}`} onClick={() => setIsOpen(!isOpen)}>
                        <Clock size={16} />
                        <span className="button-text">{displayTime}</span>
                        <ChevronDown size={14} className={`chevron ${isOpen ? 'rotate' : ''}`} />
                    </div>

                    {isOpen && (
                        <div className="time-dropdown-portal three-column">
                            {/* Hours Column */}
                            <div className="time-picker-column">
                                <div className="time-picker-column-header">Hr</div>
                                {hours.map((h, idx) => (
                                    <div
                                        key={h}
                                        ref={el => hourRefs.current[idx] = el}
                                        className={`time-picker-item ${currentHour12 === h ? 'selected' : ''}`}
                                        onClick={() => emitChange(h, roundedMin, currentPeriod)}
                                    >
                                        {h}
                                    </div>
                                ))}
                            </div>

                            {/* Minutes Column */}
                            <div className="time-picker-column">
                                <div className="time-picker-column-header">Min</div>
                                {minutes.map((m, idx) => {
                                    const isSel = Number(m) === roundedMin;
                                    return (
                                        <div
                                            key={m}
                                            ref={el => minRefs.current[idx] = el}
                                            className={`time-picker-item ${isSel ? 'selected' : ''}`}
                                            onClick={() => emitChange(currentHour12, m, currentPeriod)}
                                        >
                                            {m}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* AM/PM Column */}
                            <div className="time-picker-column">
                                <div className="time-picker-column-header">AM/PM</div>
                                {periods.map((p, idx) => (
                                    <div
                                        key={p}
                                        ref={el => periodRefs.current[idx] = el}
                                        className={`time-picker-item ${currentPeriod === p ? 'selected' : ''}`}
                                        onClick={() => emitChange(currentHour12, roundedMin, p)}
                                    >
                                        {p}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default GoogleStyleDateTimePicker;
