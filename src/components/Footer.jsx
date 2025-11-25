import React from 'react';
import { Twitter, Instagram, Facebook } from 'lucide-react';
import './Footer.css';

const Footer = () => {
    return (
        <footer className="footer">
            <div className="container">
                <div className="footer-content">
                    <div className="footer-brand">
                        <h2 className="footer-logo gradient-text">EASY STONES</h2>
                        <p className="footer-desc">
                            Premium quality stones for your dream spaces. Elegance set in stone.
                        </p>
                    </div>

                    <div className="footer-links">
                        <div className="link-column">
                            <h3>Shop</h3>
                            <a href="#">New Arrivals</a>
                            <a href="#">Best Sellers</a>
                            <a href="#">Accessories</a>
                            <a href="#">Sale</a>
                        </div>

                        <div className="link-column">
                            <h3>Support</h3>
                            <a href="#">FAQ</a>
                            <a href="#">Shipping</a>
                            <a href="#">Returns</a>
                            <a href="#">Contact</a>
                        </div>

                        <div className="link-column">
                            <h3>Social</h3>
                            <div className="social-icons">
                                <a href="#" aria-label="Twitter"><Twitter size={20} /></a>
                                <a href="#" aria-label="Instagram"><Instagram size={20} /></a>
                                <a href="#" aria-label="Facebook"><Facebook size={20} /></a>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="footer-bottom">
                    <p>&copy; 2024 Easy Stones. All rights reserved.</p>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
