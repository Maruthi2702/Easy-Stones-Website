import React, { useState } from 'react';
import { MapPin, Phone, Mail, Clock, Send } from 'lucide-react';
import { API_URL } from '../config/api';
import './ContactPage.css';
import { formatPhoneInput } from '../utils/phoneUtils';

const ContactPage = () => {
    const [formData, setFormData] = useState({
        name: '',
        company: '',
        email: '',
        phone: '',
        message: ''
    });
    const [status, setStatus] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setStatus(null);

        try {
            const response = await fetch(`${API_URL}/api/contact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (response.ok) {
                setStatus({ type: 'success', message: 'Message sent successfully! We\'ll get back to you soon.' });
                setFormData({ name: '', company: '', email: '', phone: '', message: '' });
            } else {
                setStatus({ type: 'error', message: data.message || 'Failed to send message. Please try again.' });
            }
        } catch (error) {
            setStatus({ type: 'error', message: 'Failed to send message. Please try again.' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="contact-page">
            <div className="contact-container">
                {/* Contact Details Section */}
                <div className="contact-details">
                    <h2>Contact Details</h2>

                    <div className="contact-info">
                        <div className="info-item">
                            <MapPin className="info-icon" size={20} />
                            <div>
                                <p>6012 S 196th St,</p>
                                <p>Kent, WA 98032</p>
                            </div>
                        </div>

                        <div className="info-item">
                            <Phone className="info-icon" size={20} />
                            <p>+1 253-514-3348</p>
                        </div>

                        <div className="info-item">
                            <Mail className="info-icon" size={20} />
                            <p>krish@easystones.com</p>
                        </div>

                        <div className="info-item">
                            <Clock className="info-icon" size={20} />
                            <div>
                                <p>Mon - Fri: 8am - 5pm</p>
                                <p>Sat: 10am - 3pm</p>
                                <p>Sun: Closed</p>
                            </div>
                        </div>
                    </div>
                    {/* Embedded Map */}
                    <div className="map-container">
                        <iframe
                            src="https://maps.google.com/maps?q=6012%20S%20196th%20St,%20Kent,%20WA%2098032&t=&z=15&ie=UTF8&iwloc=&output=embed"
                            width="100%"
                            height="300"
                            style={{ border: 0, borderRadius: '12px' }}
                            allowFullScreen=""
                            loading="lazy"
                            referrerPolicy="no-referrer-when-downgrade"
                            title="Easy Stones Location"
                        ></iframe>
                    </div>
                </div>

                {/* Contact Form Section */}
                <div className="contact-form-section">
                    <h2>Send a Message</h2>
                    <p className="form-subtitle">
                        For project quotes, please use our <a href="#" className="quote-link">Request a Quote</a> page.
                    </p>

                    {status && (
                        <div className={`form-status ${status.type}`}>
                            {status.message}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="contact-form">
                        <input
                            type="text"
                            name="name"
                            placeholder="Name"
                            value={formData.name}
                            onChange={handleChange}
                            required
                        />

                        <input
                            type="text"
                            name="company"
                            placeholder="Company Name"
                            value={formData.company}
                            onChange={handleChange}
                        />

                        <input
                            type="email"
                            name="email"
                            placeholder="E-Mail"
                            value={formData.email}
                            onChange={handleChange}
                            required
                        />

                        <input
                            type="tel"
                            name="phone"
                            placeholder="(555) 000-0000"
                            value={formData.phone}
                            onChange={(e) => {
                                const val = formatPhoneInput(e.target.value);
                                setFormData({ ...formData, phone: val });
                            }}
                        />

                        <textarea
                            name="message"
                            placeholder="How can we help you?"
                            value={formData.message}
                            onChange={handleChange}
                            rows="6"
                            required
                        ></textarea>

                        <button type="submit" className="submit-btn" disabled={isSubmitting}>
                            {isSubmitting ? 'Sending...' : 'Send Message'}
                            <Send size={18} />
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default ContactPage;
