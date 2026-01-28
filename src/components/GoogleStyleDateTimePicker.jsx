import React, { useState, useEffect, useRef } from 'react';
import { Clock, ChevronDown } from 'lucide-react';
import CustomDatePicker from './CustomDatePicker';

const GoogleStyleDateTimePicker = ({ value, onChange, required }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    // Parse the incoming ISO string
    const dateObj = value ? new Date(value) : new Date();

    // Format Display Time: "10:30 AM"
    const displayTime = dateObj.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });

    // Helper to get YYYY-MM-DD
    const getFormattedDateStr = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // Generate 15-minute intervals for the dropdown
    const timeSlots = React.useMemo(() => {
        const slots = [];
        for (let hour = 0; hour < 24; hour++) {
            for (let min = 0; min < 60; min += 15) {
                const d = new Date();
                d.setHours(hour, min, 0, 0);
                slots.push({
                    label: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
                    hour,
                    min
                });
            }
        }
        return slots;
    }, []);

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

    const handleDateChange = (newDateStr) => {
        // newDateStr is "YYYY-MM-DD"
        if (!newDateStr) return;

        const [year, month, day] = newDateStr.split('-').map(Number);

        // Create new date preserving current time
        const newDate = new Date(dateObj);
        newDate.setFullYear(year);
        newDate.setMonth(month - 1);
        newDate.setDate(day);

        // Format to local ISO (YYYY-MM-DDTHH:mm)
        const offset = newDate.getTimezoneOffset() * 60000;
        const localISO = new Date(newDate - offset).toISOString().slice(0, 16);
        onChange(localISO);
    };

    const handleTimeSelect = (slot) => {
        const newDate = new Date(dateObj);
        newDate.setHours(slot.hour);
        newDate.setMinutes(slot.min);

        const offset = newDate.getTimezoneOffset() * 60000;
        const localISO = new Date(newDate - offset).toISOString().slice(0, 16);
        onChange(localISO);
        setIsOpen(false);
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
                        <div className="time-dropdown-portal">
                            {timeSlots.map((slot, idx) => (
                                <div
                                    key={idx}
                                    className={`time-slot ${displayTime === slot.label ? 'selected' : ''}`}
                                    onClick={() => handleTimeSelect(slot)}
                                >
                                    {slot.label}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default GoogleStyleDateTimePicker;
