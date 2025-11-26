import React from 'react';
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
                            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                                <path d="M10 10L20 5L30 10L20 15L10 10Z" fill="#D4A574" />
                                <path d="M10 15L20 20L30 15L20 25L10 15Z" fill="#C89456" />
                                <path d="M10 20L20 25L30 20L20 30L10 20Z" fill="#B8843D" />
                            </svg>
                        </div>
                        <p className="footer-desc">
                            Premium stone surfaces for residential and commercial applications.
                            Our extensive inventory includes natural stone, engineered quartz, and porcelain materials.
                        </p>
                        <div className="social-icons">
                            <a href="#" aria-label="Facebook"><Facebook size={20} /></a>
                            <a href="#" aria-label="Instagram"><Instagram size={20} /></a>
                            <a href="#" aria-label="LinkedIn"><Linkedin size={20} /></a>
                        </div>
                    </div>

                    {/* Products Column */}
                    <div className="link-column">
                        <h3>PRODUCTS</h3>
                        <a href="#products">All Products</a>
                        <a href="#natural-stone">Natural Stone</a>
                        <a href="#quartz">Quartz</a>
                        <a href="#natural-stones">Natural Stones</a>
                        <a href="#live-inventory">Live Inventory</a>
                    </div>

                    {/* Company Column */}
                    <div className="link-column">
                        <h3>COMPANY</h3>
                        <a href="#about">About Us</a>
                        <a href="#careers">Careers</a>
                        <a href="#locations">Locations</a>
                        <a href="#contact">Contact Us</a>
                        <a href="#blog">Blog</a>
                    </div>

                    {/* Contact Column */}
                    <div className="link-column">
                        <h3>CONTACT</h3>
                        <a href="tel:+16783872900">+1 678-387-2900</a>
                        <a href="mailto:info.atl@easystones.com">info.atl@easystones.com</a>
                        <p className="contact-address">
                            6080 Northbelt Drive,<br />
                            Norcross,<br />
                            GA 3007
                        </p>
                        <a href="#locations" className="view-locations">View All Locations →</a>
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
