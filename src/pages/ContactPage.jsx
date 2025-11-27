import React, { useState } from 'react';
import { MapPin, Phone, Mail, Clock, Send } from 'lucide-react';
import { API_URL } from '../config/api';
import './ContactPage.css';

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
                                <p>6080 Northbelt Drive,</p>
                                <p>Norcross, GA 30071</p>
                            </div>
                        </div>

                        <div className="info-item">
                            <Phone className="info-icon" size={20} />
                            <p>+1 678-387-2900</p>
                        </div>

                        <div className="info-item">
                            <Mail className="info-icon" size={20} />
                            <p>info.atl@easystones.com</p>
                        </div>

                        <div className="info-item">
                            <Clock className="info-icon" size={20} />
                            <div>
                                <p>Mon - Fri: 9am - 5pm</p>
                                <p>Sat: 9am - 1pm</p>
                                <p>Sun: Closed</p>
                            </div>
                        </div>
                    </div>

                    {/* Embedded Map */}
                    <div className="map-container">
                        <iframe
                            src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3308.8!2d-84.2!3d33.95!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x88f5a1e8e8e8e8e8%3A0x1234567890abcdef!2s6080%20Northbelt%20Dr%2C%20Norcross%2C%20GA%2030071!5e0!3m2!1sen!2sus!4v1234567890123!5m2!1sen!2sus"
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
                            placeholder="Phone"
                            value={formData.phone}
                            onChange={handleChange}
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
