import React, { useState, useEffect, useRef } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import './CustomDatePicker.css';

const CustomDatePicker = ({ value, onChange, placeholder = 'Select date', required }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [displayDate, setDisplayDate] = useState(new Date());
    const dropdownRef = useRef(null);

    // Parse value to Date object
    const selectedDate = value ? new Date(value + 'T00:00:00') : null;

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Format display value
    const formatDisplay = (date) => {
        if (!date) return '';
        return date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    // Get calendar days for current month
    const getCalendarDays = () => {
        const year = displayDate.getFullYear();
        const month = displayDate.getMonth();

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDay = firstDay.getDay(); // 0 = Sunday

        const days = [];

        // Previous month days
        const prevMonthLastDay = new Date(year, month, 0).getDate();
        for (let i = startDay - 1; i >= 0; i--) {
            days.push({
                day: prevMonthLastDay - i,
                isCurrentMonth: false,
                date: new Date(year, month - 1, prevMonthLastDay - i)
            });
        }

        // Current month days
        for (let day = 1; day <= lastDay.getDate(); day++) {
            days.push({
                day,
                isCurrentMonth: true,
                date: new Date(year, month, day)
            });
        }

        // Next month days to fill the grid
        const remainingDays = 42 - days.length; // 6 rows * 7 days
        for (let day = 1; day <= remainingDays; day++) {
            days.push({
                day,
                isCurrentMonth: false,
                date: new Date(year, month + 1, day)
            });
        }

        return days;
    };

    const handlePrevMonth = () => {
        setDisplayDate(new Date(displayDate.getFullYear(), displayDate.getMonth() - 1, 1));
    };

    const handleNextMonth = () => {
        setDisplayDate(new Date(displayDate.getFullYear(), displayDate.getMonth() + 1, 1));
    };

    const handleToday = () => {
        const today = new Date();
        setDisplayDate(today);
        handleDateSelect(today);
    };

    const handleDateSelect = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateString = `${year}-${month}-${day}`;
        onChange(dateString);
        setIsOpen(false);
    };

    const isToday = (date) => {
        const today = new Date();
        return date.toDateString() === today.toDateString();
    };

    const isSelected = (date) => {
        return selectedDate && date.toDateString() === selectedDate.toDateString();
    };

    const calendarDays = getCalendarDays();
    const monthYear = displayDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    return (
        <div className="custom-datepicker" ref={dropdownRef}>
            <div className="datepicker-input" onClick={() => setIsOpen(!isOpen)}>
                <Calendar size={16} />
                <span className={selectedDate ? 'has-value' : 'placeholder'}>
                    {selectedDate ? formatDisplay(selectedDate) : placeholder}
                </span>
                <ChevronRight size={14} className={isOpen ? 'rotate' : ''} />
            </div>

            {isOpen && (
                <div className="datepicker-dropdown">
                    <div className="datepicker-header">
                        <button type="button" onClick={handlePrevMonth} className="nav-btn">
                            <ChevronLeft size={16} />
                        </button>
                        <span className="month-year">{monthYear}</span>
                        <button type="button" onClick={handleNextMonth} className="nav-btn">
                            <ChevronRight size={16} />
                        </button>
                    </div>

                    <div className="datepicker-weekdays">
                        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                            <div key={day} className="weekday">{day}</div>
                        ))}
                    </div>

                    <div className="datepicker-days">
                        {calendarDays.map((dayObj, idx) => (
                            <button
                                key={idx}
                                type="button"
                                className={`day ${!dayObj.isCurrentMonth ? 'other-month' : ''} ${isToday(dayObj.date) ? 'today' : ''} ${isSelected(dayObj.date) ? 'selected' : ''}`}
                                onClick={() => handleDateSelect(dayObj.date)}
                            >
                                {dayObj.day}
                            </button>
                        ))}
                    </div>

                    <div className="datepicker-footer">
                        <button type="button" onClick={handleToday} className="today-btn">
                            Today
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CustomDatePicker;
