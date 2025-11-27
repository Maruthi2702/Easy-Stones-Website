import React, { useState } from 'react';
import './WarrantyPage.css';

const WarrantyPage = () => {
    const [activeSection, setActiveSection] = useState('warranty');

    const renderContent = () => {
        switch (activeSection) {
            case 'warranty':
                return (
                    <section className="warranty-section">
                        <h2>Moda Quartz Residential 15/Commercial 10 Year Limited Warranty</h2>
                        <p>
                            Easy Stones offers a limited warranty on Moda Quartz surfacing, warranting that the material will be free of manufacturing defects.
                            This warranty covers product defects for a period of fifteen years residential and ten years commercial after the date of installation.
                            If it is determined by Easy Stones or its authorized warranty service agent that a defect in the material exists within the warranty period,
                            Easy Stones will, at its sole option, repair or replace the defective Moda Quartz materials in accordance with the following warranty provision and exclusions.
                        </p>

                        <h3>Terms and Conditions</h3>
                        <p>The limited warranty applies to Moda Quartz surfacing products installed after November 1, 2018.</p>
                        <ul>
                            <li>The limited warranty applies to Moda Quartz surfacing materials only.</li>
                            <li>The limited warranty applies to Moda Quartz surfacing materials that have been fabricated and installed in accordance with “industry standard” fabrication practices in the transportation, storage, handling, fabrication, and installation. Improper fabrication or installation is the responsibility of the fabricator and installer.</li>
                            <li>The limited warranty applies to Moda Quartz surfacing materials that have been properly maintained in accordance with the Care & Maintenance Guidelines.</li>
                            <li>The limited warranty applies to Moda Quartz surfacing materials that have been permanently installed in an interior application and have not been moved from the original location.</li>
                        </ul>

                        <h3>Exclusions</h3>
                        <p>The limited warranty shall not apply to the following:</p>
                        <ul>
                            <li>Products and/or materials that have not been paid for in full.</li>
                            <li>Issues or occurrences that are inherent characteristics of quartz surfacing, regardless of whether viewed as a defect by the purchaser.</li>
                            <li>Damage caused by faulty or improper fabrication and installation, including but not limited to seams, seam performance, and caulking.</li>
                            <li>Damage caused by any instability or improper support occurring in the property in which the product has been installed, including but not limited to, shifting, settling, or movement of the substrate.</li>
                            <li>Damage caused to any materials that have been moved, removed, or relocated from its original place of installation.</li>
                            <li>Damage caused by any form of abuse, exposure to excessive heat, accidents, or misuse including but not limited to, scratches, stains, chips, or cracks.</li>
                            <li>Products in which the factory applied surface finish has been altered in any way and/or damage caused by chemicals.</li>
                            <li>Products installed with known or visible manufacturing defects at time of fabrication and/or installation.</li>
                            <li>Color variance or variations in color, shape, size, or distribution of particulates inherent in the natural quartz, or natural variations in background color, or pattern.</li>
                            <li>Other repairs and modifications, including but not limited to, plumbing, electrical, tile and cabinets that may need to be performed to properly repair or replace the Moda Quartz surfacing materials.</li>
                            <li>All outdoor, or non-interior applications regardless of coverage or exposure to the elements.</li>
                        </ul>

                        <p>
                            Easy Stones is not responsible for damage or injury caused in whole, or part by acts of God, job site conditions, architectural or engineering design, structural movement, acts of vandalism, or accidents.
                        </p>

                        <h3>Transferability</h3>
                        <p>
                            The limited warranty is extended to the original purchaser and may be transferred or assigned. A purchase receipt, or proof of original purchase date will be required to receive warranty service. If transferred, a new warranty registration must be submitted with proof of the original purchase. The transferred warranty will be valid for the remainder of the original warranty period.
                        </p>

                        <h3>Disclaimers</h3>
                        <p>
                            No other express or implied warranties of merchantability or fitness for a particular purpose are made by the warranty except those expressly provided herein. Under no circumstances shall Easy Stones be liable for any loss or damage arising from the purchase, use or inability to use this product, or for any special, indirect, incidental or consequential damages. In no case will Easy Stones be liable for labor to remove and/or reinstall Moda Quartz surfaces, or other similar activities necessary to complete the removal and replacement of the defective material.
                        </p>
                        <p>
                            The limited warranty entitles the purchaser to specific legal rights. Other rights may also be available, which may vary from state to state. Some states do not permit the exclusion or limitation of implied warranties, or of incidental, or consequential damages, so the above limitation or exclusion may not apply to you. To know what your legal rights are, consult your local, or state consumer affairs office or your state's attorney general.
                        </p>

                        <h3>Obtaining Service</h3>
                        <p>
                            To obtain service under the limited warranty, please contact the source from which you purchased your Moda Quartz product. You must permit your certified installer or Easy Stones’ authorized agents to inspect your quartz product, and you must reasonably cooperate with your certified installer and Easy Stones’ agents in the efforts to provide service in conjunction with this limited warranty. If the problem is not handled to your satisfaction, please contact us directly in writing, or calling at the following:
                        </p>

                        <div className="warranty-contact-info">
                            <p><strong>Easy Surfaces Corporation DBA Easy Stones</strong></p>
                            <p>6080 Northbelt Drive</p>
                            <p>Norcross, GA 30071</p>
                            <p><strong>Office:</strong> 678-387-2900</p>
                            <p><strong>Attention:</strong> Moda Quartz Warranty</p>
                            <p><strong>Email:</strong> info@easystones.com</p>
                        </div>
                    </section>
                );
            case 'care':
                return (
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
                );
            case 'tech-data':
                return (
                    <section className="warranty-section">
                        <h2>Technical Data</h2>
                        <p>Technical specifications and performance data for Moda Quartz surfaces are available upon request.</p>
                    </section>
                );
            case 'safety-data':
                return (
                    <section className="warranty-section">
                        <h2>Safety Data</h2>
                        <p>Moda Quartz is safe for use in food preparation areas and meets all relevant safety standards.</p>
                    </section>
                );
            default:
                return null;
        }
    };

    return (
        <div className="warranty-page">
            <div className="warranty-hero">
                <div className="warranty-hero-content">
                    <h1>Resources & Warranty</h1>
                    <p>Quality, Care, and Technical Information</p>
                </div>
            </div>

            <div className="warranty-nav-container">
                <div className="sub-nav">
                    <button
                        className={activeSection === 'warranty' ? 'active' : ''}
                        onClick={() => setActiveSection('warranty')}
                    >
                        Warranty
                    </button>
                    <button
                        className={activeSection === 'care' ? 'active' : ''}
                        onClick={() => setActiveSection('care')}
                    >
                        Care & Maintenance
                    </button>
                    <button
                        className={activeSection === 'tech-data' ? 'active' : ''}
                        onClick={() => setActiveSection('tech-data')}
                    >
                        Technical Data
                    </button>
                    <button
                        className={activeSection === 'safety-data' ? 'active' : ''}
                        onClick={() => setActiveSection('safety-data')}
                    >
                        Safety Data
                    </button>
                </div>
            </div>

            <div className="warranty-container">
                {renderContent()}
            </div>
        </div>
    );
};

export default WarrantyPage;
