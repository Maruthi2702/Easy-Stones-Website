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
                        <h2>Moda Quartz Customer Policies & Recommended Fabrication Practices</h2>
                        <p>
                            Moda Quartz is a perfect blend of polymeric technology combined with the beauty and durability of Natural Quartz.
                            Moda Quartz surfaces are food safe, extremely durable, very easy to maintain and come with a transferable Limited
                            15-Year Residential and 10-Year Commercial warranty. Outlined in this document are the recommended fabrication
                            practices and other policies required to maintain service under the Limited Warranty.
                        </p>

                        <h3>Application</h3>
                        <p>
                            Moda Quartz is ideal for indoor applications such as kitchen and bath counter tops, shower walls, service counters,
                            desks, flooring and decorative applications; as the colors are consistent and the surface is virtually bacteria-free
                            when properly cleaned. Exterior applications are not recommended and void product warranty. Exposure to unfiltered
                            direct sunlight may result in color fading and/or warping of material. Most modern windows provide a sufficient
                            amount of filtration to prevent UV fade and warping of material. It is recommended one check with window manufacture
                            for information regarding UV light filtration and consider product exposure to sunlight during the design process.
                        </p>

                        <h3>Composition & Materials</h3>
                        <p>
                            Moda Quartz is composed up to 93% natural quartz and 7% resin; as a result, variance in color, shade and pattern
                            is an inherent trait expected of this product. Please refer to samples only as a general indication of a particular
                            color's design pattern, aesthetics, and hue. Samples are not guaranteed to be an exact replica of Moda Quartz slabs
                            and may vary from actual, installed Moda Quartz surface. It is the responsibility of the fabricator to visually
                            inspect color match of any slabs to be fabricated and installed prior to cutting into the material.
                        </p>
                        <p>
                            Moda Quartz is not a seamless product; seams are generally visible. Inspection of color coordination across seams
                            and multiple pieces is strongly recommended.
                        </p>
                        <p>
                            Small resin blotches or random distribution of particulates are an inherent part of the overall design and composition,
                            and are not considered to be defects or product non-conformity.
                        </p>
                        <p>
                            The quality of engineered stone will vary from brand to brand depending on the quality of resin and raw materials
                            used in the manufacturing process.
                        </p>

                        <h3>Material Handling & Storage</h3>
                        <p>
                            Upon receiving the material, the protective plastic sheet must be removed and material inspected. The fabricator is
                            ultimately responsible for inspection of Moda Quartz prior to any cutting, fabrication, and installation, since most
                            product non-conformity* issues can be more properly addressed prior to the cutting of material or permanent installation
                            (*claims on slab material that has not been cut, fabricated, or altered in any way shape or form).
                        </p>
                        <p>
                            Material should be stored on a-frames, or on vertical racks. Metal a-frames, or racks should be padded to avoid
                            damaging surface of material. The polished face should not be stored in direct sunlight. Avoid storing material in
                            extreme weather/temperature conditions. Acclimate material to temperature of fabrication shop for at least 24 hours
                            prior to cutting material. Do not cut material that is frozen. Do not heat material using any type of torch, or open
                            flame. It is recommended that material be covered if stored outside to help protect from elements.
                        </p>

                        <h3>Product Identification</h3>
                        <p>
                            Moda Quartz slabs will be individually marked on the spine with a serial number label. There will also be a
                            manufactures stamp on the back of the slabs. To obtain service under the warranty, the serial number information,
                            customer name, physical address and product application must be submitted to Easy Surfaces Corporation.
                        </p>

                        <h3>General Fabrication & Installation Requirements</h3>
                        <p>
                            Fabrication of Moda Quartz differs slightly than fabrication of natural stone. As an engineered product there may
                            be tension within the slab. This is not a defect, but rather an inherent result of the manufacturing process. To
                            relieve tension, it is recommended that a relief cut, or relief hole be drilled prior to cutting into material.
                            The following guidelines are to be followed when cutting Moda Quartz:
                        </p>
                        <ul>
                            <li>Dress the saw blade. Make sure the diamonds are exposed. The build-up of sludge and resin from cutting natural stone and quartz slabs can coat the saw blade effectively killing the blades ability to cut while generating excess heat.</li>
                            <li>Always cut with water.</li>
                            <li>Pay attention to AMP draw and cut speed.</li>
                            <li>Always cut from the outside of the slab towards the inside.</li>
                            <li>Prior to beginning relief cut, it is recommended that a 1" diameter relief hold be drilled at the termination point of the cut. Always cut towards the relief hole.</li>
                            <li>Make the shortest cut first.</li>
                            <li>Inside Corners must have a minimum 3/8" radius. Square corners will create stress points in the material that may result in cracking during the fabrication process, or after installation.</li>
                        </ul>

                        <h3>Not Covered under Moda Quartz Warranty</h3>
                        <ul>
                            <li>Failure to comply with the recommended storage, handling, usage, care & maintenance guidelines. It is the responsibility of the Fabricator, or selling agent to advise end user on the Moda Quartz Warranty and Care & Maintenance guidelines.</li>
                            <li>Fabrication or installation error.</li>
                            <li>Damage caused by accidents, abuse, misuse, act of nature, job-site conditions or structural movement.</li>
                            <li>Installed Moda Quartz surface product that is removed from the original place of installation.</li>
                            <li>Moda Quartz is composed of natural quartz. As a result, variance in color, size, shape and particulate distribution pattern is an inherent trait expected of this product. (Slabs purchased from same lot # should match. If slabs from same lot # do not match, please notify Easy Surfaces Corporation prior to cutting and installation to resolve the issue.)</li>
                            <li>Chips and cracks. Chips may be caused by impact. Cracks may be cause by "dry" cutting, polishing, unevenness, or settling.</li>
                            <li>Scratches. Moda Quartz is scratch resistant, but not scratch-proof. Cutting boards are highly recommended. Material should be covered after installation to avoid damage by other trades.</li>
                            <li>Minor conditions such as stains or water spots. Moda Quartz is stain resistant, but not stain-proof. To clean tough stains, please visit our care and maintenance section of our website at www.easystones.com</li>
                            <li>Supplemental repair, including, but not limited to, electrical, tile or wall surfaces, and plumbing modifications necessary to repair Moda Quartz.</li>
                            <li>Appearance of edge, re-fabrication, or polishing of surface slabs.</li>
                            <li>Exposure to extreme heat. Trivets must be used for any hot pots, pans, crock pots, and for any heat generating items. Heat resistant pads are highly recommended.</li>
                            <li>Seam appearance.</li>
                        </ul>

                        <p><strong>Note:</strong> Moda Quartz Policies are subject to change without notice at Easy Stones discretion. Please check with your local branch for the latest updates.</p>

                        <div className="warranty-download">
                            <a
                                href="/Moda Quartz Customer Policies and Recommended Fabrication Practices_2023.pdf"
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
                                Download Customer Policies PDF
                            </a>
                        </div>
                    </section>
                ); case 'safety-data':
                return (
                    <section className="warranty-section">
                        <h2>Moda Quartz QC Standards</h2>

                        <div className="table-responsive">
                            <table className="technical-data-table qc-standards-table">
                                <thead>
                                    <tr>
                                        <th>Defect</th>
                                        <th>Color Category</th>
                                        <th>Field Spec</th>
                                        <th>Quantity / Disposition</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td rowSpan="2">Blotch</td>
                                        <td>Double/single</td>
                                        <td>Max 2m Diameter</td>
                                        <td>&gt; One per quadrant<br />= Unacceptable</td>
                                    </tr>
                                    <tr>
                                        <td>multi</td>
                                        <td>Max 4mm Diameter</td>
                                        <td></td>
                                    </tr>
                                    <tr>
                                        <td>Face Side Voids</td>
                                        <td>All</td>
                                        <td>Any size</td>
                                        <td>All = Unacceptable</td>
                                    </tr>
                                    <tr>
                                        <td>Water mark</td>
                                        <td>Mono/single</td>
                                        <td>Any size</td>
                                        <td>All = Unacceptable</td>
                                    </tr>
                                    <tr>
                                        <td>Scratch Marks</td>
                                        <td>All</td>
                                        <td>Undetectable with the naked eye</td>
                                        <td>All = Unacceptable</td>
                                    </tr>
                                    <tr>
                                        <td>Polishing Mark</td>
                                        <td>All</td>
                                        <td>Any size</td>
                                        <td>All = Unacceptable</td>
                                    </tr>
                                    <tr>
                                        <td>Contaminants</td>
                                        <td>Artificial Colored spot</td>
                                        <td>Any size</td>
                                        <td>All = Unacceptable</td>
                                    </tr>
                                    <tr>
                                        <td>Dry spot</td>
                                        <td>All</td>
                                        <td>Max 2 mm Diameter</td>
                                        <td>&gt; Four per slab<br />&gt; One per Quadrant<br />= Unacceptable</td>
                                    </tr>
                                    <tr>
                                        <td>Surface Cracking</td>
                                        <td>All</td>
                                        <td>Any size</td>
                                        <td>All = Unacceptable</td>
                                    </tr>
                                    <tr>
                                        <td>Fissure</td>
                                        <td>All</td>
                                        <td>Any size</td>
                                        <td>All = Unacceptable</td>
                                    </tr>
                                    <tr>
                                        <td>Gloss</td>
                                        <td>All</td>
                                        <td>Glossmeter, 60°, avg. of 5</td>
                                        <td>Single Color: &lt; 45<br />Multi Color: &lt; 60<br />= Unacceptable</td>
                                    </tr>
                                    <tr>
                                        <td>Backside - Void, Hole, Surface Crack, Missing Material</td>
                                        <td>All</td>
                                        <td>Max 1mm Diameter</td>
                                        <td>&gt; Two per quadrant<br />= Unacceptable</td>
                                    </tr>
                                    <tr>
                                        <td>Thickness</td>
                                        <td>All</td>
                                        <td>Calipers, 4 side</td>
                                        <td>2 cm = 19.5 – 20.5 mm<br />3 cm = 29.5 – 30.5 mm</td>
                                    </tr>
                                    <tr>
                                        <td>Proximity Standard</td>
                                        <td>All</td>
                                        <td>-</td>
                                        <td>Any 2 Faults (any size) within 100mm of each other<br />= Unacceptable</td>
                                    </tr>
                                    <tr>
                                        <td>Warp</td>
                                        <td>All</td>
                                        <td>&lt; 1 mm over 1000 mm</td>
                                        <td>&gt; 1mm = Unacceptable</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <div className="warranty-download">
                            <a
                                href="/Moda Quartz QC Standards.pdf"
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
                                Download QC Standards PDF
                            </a>
                        </div>
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
                        Customer Policies
                    </button>
                    <button
                        className={activeSection === 'safety-data' ? 'active' : ''}
                        onClick={() => setActiveSection('safety-data')}
                    >
                        Quality Control Standards
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
