import React from 'react';
import { Link } from 'react-router-dom';
import { Facebook, Instagram, Linkedin } from 'lucide-react';
import './Footer.css';

const Footer = () => {
    return (
        <footer className="footer">
            <div className="container">
                <div className="footer-content">
                    {/* Brand Section */}
                    <div className="footer-brand">
                        <div className="footer-logo">
                            <img src="/images/footer-logo.png" alt="Easy Stones Logo" width="60" height="60" />
                        </div>
                        <p className="footer-desc">
                            Premium stone surfaces for residential and commercial applications.
                            Our extensive inventory includes natural stone, engineered quartz, and porcelain materials.
                        </p>
                        <div className="social-icons">
                            <a href="https://www.facebook.com/EasyStonesGreensboro" aria-label="Facebook"><Facebook size={20} /></a>
                            <a href="https://www.instagram.com/easystones_gso/#" aria-label="Instagram"><Instagram size={20} /></a>
                            <a href="https://www.linkedin.com/company/easy-stones/" aria-label="LinkedIn"><Linkedin size={20} /></a>
                        </div>
                    </div>

                    {/* Products Column */}
                    <div className="link-column">
                        <h3>PRODUCTS</h3>
                        <Link to="/" state={{ activeCategory: 'Moda Quartz' }}>Moda Quartz</Link>
                        <Link to="/" state={{ activeCategory: 'MODA PST' }}>Moda PST</Link>
                        <Link to="/" state={{ activeCategory: 'Quartzite' }}>Quartzite</Link>
                        <Link to="/" state={{ activeCategory: 'Granite' }}>Granite</Link>
                        <Link to="/" state={{ activeCategory: 'Marble' }}>Marble</Link>
                    </div>

                    {/* Warranty Column */}
                    <div className="link-column">
                        <h3>WARRANTY</h3>
                        <Link to="/warranty">Warranty</Link>
                        <Link to="/warranty?section=care">Care & Maintenance</Link>
                        <Link to="/warranty?section=policies">Customer Policies</Link>
                        <Link to="/warranty?section=qc">Quality Control Standards</Link>
                    </div>

                    {/* Contact Column */}
                    <div className="link-column">
                        <h3>CONTACT</h3>
                        <a href="tel:+12535143348">+1 253-514-3348</a>
                        <a href="mailto:info.sea@easystones.com">info.sea@easystones.com</a>
                        <p className="contact-address">
                            22601 76th Ave S,<br />
                            Kent, WA 98032
                        </p>
                    </div>
                </div>

                <div className="footer-bottom">
                    <p>© 2025 Easy Stones. All rights reserved.</p>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
