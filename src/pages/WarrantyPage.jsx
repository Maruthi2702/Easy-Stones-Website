import React from 'react';
import './WarrantyPage.css';

const WarrantyPage = () => {
    return (
        <div className="warranty-page">
            <div className="warranty-hero">
                <div className="warranty-hero-content">
                    <h1>Warranty Information</h1>
                    <p>Our commitment to quality and your peace of mind.</p>
                </div>
            </div>

            <div className="warranty-container">
                <section className="warranty-section">
                    <h2>Limited Lifetime Warranty</h2>
                    <p>
                        Easy Stones provides a Limited Lifetime Warranty to the original owner of the installed
                        Easy Stones quartz surfaces. This warranty covers defects in manufacturing when the product
                        is fabricated and installed by a certified Easy Stones fabricator.
                    </p>
                </section>

                <section className="warranty-section">
                    <h2>Terms and Conditions</h2>
                    <ul>
                        <li>This warranty applies only to Easy Stones quartz surfacing materials and does not cover any other products, including other quartz surfacing products.</li>
                        <li>This warranty applies only to Easy Stones quartz surfacing materials that have been permanently installed in the interior of single-family residences and have not been moved from their original installation.</li>
                        <li>This warranty is not transferable and applies only to the original owner of the residence where the product was originally installed.</li>
                    </ul>
                </section>

                <section className="warranty-section">
                    <h2>What is Not Covered</h2>
                    <p>
                        This warranty does not cover:
                    </p>
                    <ul>
                        <li>Routine maintenance and cleaning.</li>
                        <li>Improper use or abuse, including but not limited to, damage from mishaps, mishandling, impact, chemical damage, or acts of nature.</li>
                        <li>Damage due to heat, including but not limited to, damage from placing hot pots or pans directly on the surface.</li>
                        <li>Color variations or particulate distribution in the stone.</li>
                    </ul>
                </section>

                <section className="warranty-section contact-section">
                    <h2>File a Claim</h2>
                    <p>
                        To file a warranty claim, please contact us with your proof of purchase and details of the issue.
                    </p>
                    <a href="/contact" className="contact-btn">Contact Us</a>
                </section>
            </div>
        </div>
    );
};

export default WarrantyPage;
