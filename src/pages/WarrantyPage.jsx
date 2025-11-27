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

                        <div className="warranty-download">
                            <a
                                href="/Moda Quartz Warranty_Easy Stones 2023.pdf"
                                download
                                className="download-pdf-btn"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                                Download Warranty PDF
                            </a>
                        </div>
                    </section>
                );
            case 'care':
                return (
                    <section className="warranty-section">
                        <h2>Moda Quartz Care & Maintenance Guidelines</h2>
                        <p>
                            Moda Quartz is a perfect blend of polymeric technology combined with the beauty and durability of Natural Quartz.
                            Moda Quartz surfaces are food safe, extremely durable, very easy to maintain and come with a transferable Limited
                            15-Year Residential and 10-Year Commercial warranty. Outlined in this document are the recommended Care & Maintenance
                            Guidelines required to maintain service under the Limited Warranty.
                        </p>

                        <h3>Quality Attributes</h3>
                        <ul>
                            <li><strong>Easy to maintain</strong> – In most cases use soft cloth, or sponge with a diluted mild dish-soap and warm water. Clean as you go!</li>
                            <li><strong>Nonporous</strong> – Requires no sealing</li>
                            <li>Variations in color, pattern, size, shape, and shade are unique inherent qualities of the product.</li>
                            <li><strong>Food Safe – Hygienic</strong> – NSF Certification in process</li>
                            <li>Greenguard Gold Certification in process</li>
                            <li><strong>Durable</strong> – Scratch & Stain Resistant</li>
                            <li>Residential 15 Year Limited Warranty; Commercial 10 Year Limited Warranty</li>
                        </ul>

                        <h3>Care & Maintenance Guidelines</h3>
                        <p>
                            While Moda Quartz is resistant to staining, it is not stain proof. Minimal maintenance and routine cleaning with
                            warm water, a mild detergent and a soft cloth will keep your Moda Quartz surface looking its best.
                        </p>
                        <p>
                            Do not apply any sealers, penetrants, or topical treatments to your Moda Quartz surface. Such products may discolor
                            the surface resembling a stain and will wear off overtime causing a dull, or inconsistent finish to the surface.
                        </p>
                        <p>
                            Moda Quartz, just like other quartz surfaces can be damaged by strong chemicals and solvents. Avoid using abrasive
                            agents such as drain, dishwasher, paint, and oven cleansers, or other high pH chemicals. Rinse your Moda Quartz
                            surface thoroughly with water should they come into contact with these types of chemicals.
                        </p>
                        <p>
                            For stubborn spots, use a soft cloth, sponge, or non-scratch pad and a mild, neutral pH / non-abrasive cleanser
                            along with plenty of water to clean the surface. Although Moda Quartz is extremely scratch resistant, it is not
                            scratch proof. Take care not to scrub too hard to create a dull spot.
                        </p>
                        <p>
                            For dried residue, it is best to lightly scrape off excess residue before attempting to clean the surface.
                            Follow above guidelines to clean the surface.
                        </p>
                        <p>
                            It is strongly recommended to use a cutting board rather than cutting, or chopping directly on your countertop surface.
                            Moda Quartz is extremely scratch resistant; HOWEVER, no surface is scratch proof.
                        </p>
                        <p>
                            Avoid placing hot objects, such as hot pans and even appliances that may emit high levels of heat as they can
                            potentially damage the surface. We recommend using a hot pad, or trivet to avoid potential thermal damage to the surface.
                        </p>

                        <h3>In Summary</h3>
                        <ul>
                            <li>Easy to maintain – In most cases use soft cloth, or sponge with a diluted mild dish-soap and warm water. Clean as you go!</li>
                            <li>High alkaline (high-pH) or acidic (low-pH) cleansers are not recommended.</li>
                            <li>Do not expose Moda Quartz to bleach, oven cleaner, Comet, Soft Scrub, SOS, pumice, batteries, paint removers, furniture stripers, tarnish, silver cleansers, or fingernail polish remover.</li>
                            <li>Do not use abrasive, or harsh scrub pads.</li>
                            <li>Do not apply any sealer, penetrating, or topical treatments under any circumstance.</li>
                            <li>Do not expose to extreme heat – use of crock pots, electric skillets, or transferring hot pots/pans directly onto Moda Quartz surfaces is not recommended and may cause damage due to thermal shock.</li>
                            <li>Recommend use of trivet, or hot pad.</li>
                            <li>Do not cut, or chop on Moda Quartz surface.</li>
                            <li>Recommend use of cutting board.</li>
                            <li>Avoid impacting, or hitting finished edges particularly around sink cutouts and above dishwasher.</li>
                        </ul>

                        <div className="warranty-download">
                            <a
                                href="/Moda Quartz Care and Maintenance Guidelines_2023.pdf"
                                download
                                className="download-pdf-btn"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                                Download Care & Maintenance PDF
                            </a>
                        </div>
                    </section>
                );
            case 'tech-data':
                return (
                    <section className="warranty-section">
                        <h2>Technical Data</h2>
                        <p>Technical specifications and performance data for Moda Quartz surfaces.</p>

                        <div className="table-responsive">
                            <table className="technical-data-table">
                                <thead>
                                    <tr>
                                        <th>Property</th>
                                        <th>Test Standard</th>
                                        <th>Results</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>Water Absorption</td>
                                        <td>ASTM C97<br />EN-14617-1</td>
                                        <td>≤0.05%</td>
                                    </tr>
                                    <tr>
                                        <td>Density</td>
                                        <td>ASTM C97<br />EN-14617-1</td>
                                        <td>≥2.1 gr/cm³</td>
                                    </tr>
                                    <tr>
                                        <td>Flexural Strength</td>
                                        <td>ASTM C880/C880M-15<br />EN-14617-2</td>
                                        <td>35.5-77.5 MPa<br />43-80 MPa</td>
                                    </tr>
                                    <tr>
                                        <td>Dimensional Stability</td>
                                        <td>EN-14617-12</td>
                                        <td>Class A</td>
                                    </tr>
                                    <tr>
                                        <td>Impact Resistance</td>
                                        <td>EN-14617-9</td>
                                        <td>5.0-14.4 L (J)</td>
                                    </tr>
                                    <tr>
                                        <td>Compressive Strength</td>
                                        <td>ASTM C170<br />EN-14617-15</td>
                                        <td>Dry: 219-299 MPa; Wet: 203-274 MPa<br />157-243 MPa</td>
                                    </tr>
                                    <tr>
                                        <td>Abrasion</td>
                                        <td>ASTM C1243-93<br />EN-14617-4</td>
                                        <td>Volume of chord: V=59.2-107.2mm³<br />Chord length: 22.0-22.6mm</td>
                                    </tr>
                                    <tr>
                                        <td>Freeze-thaw Resistance</td>
                                        <td>ASTM C1026<br />EN-14617-2 & EN-14167-5</td>
                                        <td>No obvious damage after 20 freeze-thaw cycles<br />KMf25= 95.1-117.7%</td>
                                    </tr>
                                    <tr>
                                        <td>Stain Resistance</td>
                                        <td>ANSI Z 124.6</td>
                                        <td>Pass</td>
                                    </tr>
                                    <tr>
                                        <td>Chemical Resistance</td>
                                        <td>ANSI Z 124.6<br />EN 14617-10</td>
                                        <td>Pass<br />Class C4</td>
                                    </tr>
                                    <tr>
                                        <td>Linear Thermal Expansion</td>
                                        <td>ANTM 372<br />EN 14617-11</td>
                                        <td>-30°C-100°C: 3.0-5.0 x 10 per °C<br />13.4-26.4 (10⁻⁵ ·C⁻¹)</td>
                                    </tr>
                                    <tr>
                                        <td>Thermal Conductivity</td>
                                        <td>EN 12664</td>
                                        <td>0.445-0.475 W/(m·K)</td>
                                    </tr>
                                    <tr>
                                        <td>Thermal Shock</td>
                                        <td>EN 14617-6</td>
                                        <td>No visual defects after 20 cycles<br />Change in mass: 0.04% to 0.06%<br />Change in flexural strength: -6.7% to 9.3%</td>
                                    </tr>
                                    <tr>
                                        <td>Boiling Water Resistance</td>
                                        <td>ANSI NEMA LD3-3.5</td>
                                        <td>No effect</td>
                                    </tr>
                                    <tr>
                                        <td>High Temperature Resistance</td>
                                        <td>ANSI NEMA LD3-2005</td>
                                        <td>No effect</td>
                                    </tr>
                                    <tr>
                                        <td>Surface Burning</td>
                                        <td>ASTM E84</td>
                                        <td>Class A</td>
                                    </tr>
                                    <tr>
                                        <td>Fire Performance</td>
                                        <td>AS 1530.3:1999</td>
                                        <td>Ignitability Index (0-20): 6-8<br />Spread of Flame Index (0-10): 0-3<br />Heat Developed Index (0-10): 2-3<br />Smoke Developed Index (0-10): 6-7</td>
                                    </tr>
                                    <tr>
                                        <td>Fire Classification</td>
                                        <td>EN 13501-1</td>
                                        <td>Wall cladding: B-s1-d0<br />Flooring and stairs: B-fl-s1</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </section>
                );
            case 'safety-data':
                return (
                    <section className="warranty-section">
                        <h2>Safety Data Sheet</h2>

                        <h3>SECTION 4: First-Aid Measures</h3>
                        <p><strong>General:</strong> In the finished material form, no special first aid measures are required. The following first aid measures must be followed during any process generating dust.</p>

                        <h4>After Inhalation</h4>
                        <p>If breathing is difficult, remove victim to fresh air and keep at rest in a position comfortable for breathing. If the victim is unconscious: Lay in a stable manner on victim's side. Call a physician immediately.</p>

                        <h4>After Skin Contact</h4>
                        <p>Brush off loose particles from skin. Remove affected clothing and wash all exposed skin area with mild soap and water, followed by warm water rinse. If skin irritation occurs: Get medical advice/attention.</p>

                        <h4>After Eye Contact</h4>
                        <p>Rinse cautiously with water for several minutes. Remove contact lenses, if present and easy to do. Continue rinsing. If eye irritation persists: Get medical advice/attention.</p>

                        <h3>SECTION 7: Handling and Storage</h3>
                        <h4>Precautions for Safe Handling</h4>
                        <ul>
                            <li>Handle in accordance with good industrial hygiene and safety procedures.</li>
                            <li>Do not handle until all safety precautions have been read and understood.</li>
                            <li>Use only outdoors or in a well-ventilated area.</li>
                            <li>Use wet cutting methods. It is not recommended to work with dry cutting methods.</li>
                            <li>For dry cuts or other forms of processing generating dusts, select an appropriately ventilated location.</li>
                            <li>Use personal protective equipment as required.</li>
                            <li>Do not breathe dust.</li>
                            <li>Avoid contact with skin, eyes and clothing.</li>
                        </ul>

                        <h4>Hygiene Measures</h4>
                        <ul>
                            <li>Do not eat, drink or smoke when using this product.</li>
                            <li>Always wash hands after handling the product.</li>
                            <li>Contaminated work clothing should not be allowed out of the workplace.</li>
                        </ul>

                        <h4>Storage Conditions</h4>
                        <ul>
                            <li>Store tiles or slabs in a suitably closed and covered place.</li>
                            <li>Do not place more than 20 slabs on rack.</li>
                            <li>Do not store for prolonged periods in direct sunlight.</li>
                            <li>Incompatible products: Strong acids.</li>
                        </ul>

                        <h3>SECTION 8: Exposure Controls/Personal Protection</h3>
                        <p><strong>Engineering Controls:</strong> Ensure good ventilation of the work station. Use general ventilation, local exhaust ventilation or process enclosure to keep the airborne concentrations below the permissible exposure limits.</p>
                        <p><strong>Environmental Controls:</strong> Avoid release to the environment. Take measures to reduce or limit air emissions and releases to soil and the aquatic environment.</p>
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
