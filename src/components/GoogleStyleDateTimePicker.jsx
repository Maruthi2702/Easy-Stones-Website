import React, { useState, useEffect, useRef } from 'react';
import { Calendar, Clock, ChevronDown } from 'lucide-react';

const GoogleStyleDateTimePicker = ({ value, onChange, required }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);
    const dateInputRef = useRef(null);

    // Parse the incoming ISO string
    const dateObj = value ? new Date(value) : new Date();

    // Format Display Date: "Wednesday, February 25, 2026"
    const displayDate = dateObj.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });

    // Format Display Time: "10:30 AM"
    const displayTime = dateObj.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });

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

    const handleDateChange = (e) => {
        const selectedDate = new Date(e.target.value);
        // Preserve current time
        selectedDate.setHours(dateObj.getHours());
        selectedDate.setMinutes(dateObj.getMinutes());

        // Format to local ISO (YYYY-MM-DDTHH:mm)
        const offset = selectedDate.getTimezoneOffset() * 60000;
        const localISO = new Date(selectedDate - offset).toISOString().slice(0, 16);
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
                {/* Date Selector */}
                <div className="picker-button date-button" onClick={() => dateInputRef.current?.showPicker()}>
                    <Calendar size={16} />
                    <span className="button-text">{displayDate}</span>
                    <input
                        type="date"
                        ref={dateInputRef}
                        className="hidden-date-input"
                        value={new Date(dateObj.getTime() - (dateObj.getTimezoneOffset() * 60000)).toISOString().split('T')[0]}
                        onChange={handleDateChange}
                        required={required}
                    />
                </div>

                <span className="picker-separator">at</span>

                {/* Time Selector */}
                <div className="time-picker-wrapper" ref={dropdownRef}>
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
