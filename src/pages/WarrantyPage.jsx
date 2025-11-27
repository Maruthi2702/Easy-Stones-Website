import React from 'react';
import './WarrantyPage.css';

const WarrantyPage = () => {
    return (
        <div className="warranty-page">
            <div className="warranty-hero">
                <div className="warranty-hero-content">
                    <h1>Moda Quartz Resources</h1>
                    <p>Quality, Care, and Warranty Information</p>
                </div>
            </div>

            <div className="warranty-container">
                <section className="warranty-section">
                    <h2>Moda Quartz Overview</h2>
                    <p>
                        Moda Quartz is a perfect blend of polymeric technology combined with the beauty and durability of natural quartz.
                        Moda Quartz surfaces are food safe, extremely durable, very easy to maintain, and come with a transferable limited warranty.
                    </p>
                </section>

                <section className="warranty-section">
                    <h2>Quality Attributes</h2>
                    <ul>
                        <li><strong>Easy to maintain:</strong> In most cases use a soft cloth or sponge with diluted mild dish soap and warm water. Clean as you go!</li>
                        <li><strong>Nonporous:</strong> Requires no sealing.</li>
                        <li><strong>Durable:</strong> Scratch and stain resistant.</li>
                        <li><strong>Food Safe:</strong> Hygienic with NSF/ANSI 51 certification.</li>
                        <li><strong>Certified:</strong> Greenguard Gold certification.</li>
                        <li><strong>Natural Variations:</strong> Variations in color, pattern, size, shape, and shade are unique inherent qualities of the product.</li>
                    </ul>
                </section>

                <section className="warranty-section">
                    <h2>Warranty Coverage</h2>
                    <div className="warranty-cards">
                        <div className="warranty-card">
                            <h3>Residential</h3>
                            <p className="warranty-year">15 Year</p>
                            <p>Transferable Limited Warranty</p>
                        </div>
                        <div className="warranty-card">
                            <h3>Commercial</h3>
                            <p className="warranty-year">10 Year</p>
                            <p>Limited Warranty</p>
                        </div>
                    </div>
                </section>

                <section className="warranty-section">
                    <h2>Care & Maintenance Guidelines</h2>
                    <p>
                        While Moda Quartz is resistant to staining, it is not stain-proof. Minimal maintenance and routine cleaning
                        with warm water, a mild detergent, and a soft cloth will keep your surface looking its best.
                    </p>

                    <h3>Do's & Don'ts</h3>
                    <ul>
                        <li><strong>DO</strong> use a soft cloth or sponge with mild dish soap and warm water.</li>
                        <li><strong>DO</strong> use a trivet or hot pad. Do not transfer hot pots/pans directly onto the surface to avoid thermal shock.</li>
                        <li><strong>DO</strong> use a cutting board. Do not cut or chop directly on the surface.</li>
                        <li><strong>DON'T</strong> use abrasive or harsh scrub pads.</li>
                        <li><strong>DON'T</strong> apply sealers, penetrants, or topical treatments.</li>
                        <li><strong>DON'T</strong> expose to extreme heat (crock pots, electric skillets).</li>
                        <li><strong>DON'T</strong> use high alkaline (high-pH) or acidic (low-pH) cleansers.</li>
                        <li><strong>AVOID</strong> bleach, oven cleaner, Comet, Soft Scrub, SOS, pumice, paint removers, silver cleansers, or nail polish remover.</li>
                    </ul>
                </section>

                <section className="warranty-section contact-section">
                    <h2>Need Assistance?</h2>
                    <p>
                        For technical support or warranty claims, please contact us.
                    </p>
                    <a href="/contact" className="contact-btn">Contact Support</a>
                </section>
            </div>
        </div>
    );
};

export default WarrantyPage;
