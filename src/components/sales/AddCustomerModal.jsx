import React, { useState, useRef, useEffect } from 'react';
import { X, Loader, Scan, Upload } from 'lucide-react';
import Tesseract from 'tesseract.js';
import { formatPhoneInput } from '../../utils/phoneUtils';
import { parseBusinessCard } from '../../utils/cardParser';
import './AddCustomerModal.css';

const AddCustomerModal = ({ show, onClose, onSave, isSaving, editingCustomer, viewingCustomer }) => {
    const [form, setForm] = useState({
        customerName: '',
        company: '',
        address: {
            street: '',
            city: '',
            state: '',
            zipCode: ''
        },
        phone: '',
        email: '',
        marketingEmail: '',
        receiveMarketing: true,
        notes: '',
        status: 'Onboarded',
        level: 'Level - 3',
        customerType: 'Fabricator',
        modaDisplay: 'No',
        modaBinder: '0'
    });

    const [scanProgress, setScanProgress] = useState(0);
    const [scanStatus, setScanStatus] = useState('idle'); // 'idle', 'camera', 'processing'
    const videoRef = useRef(null);
    const canvasRef = useRef(null);

    const activeCustomer = viewingCustomer || editingCustomer;

    // Populate form fields if editing or viewing
    useEffect(() => {
        if (activeCustomer && show) {
            setForm({
                customerName: activeCustomer.contactName || activeCustomer.customerName || activeCustomer.name || '',
                company: activeCustomer.company || '',
                address: {
                    street: activeCustomer.address?.street || '',
                    city: activeCustomer.address?.city || activeCustomer.city || '',
                    state: activeCustomer.address?.state || '',
                    zipCode: activeCustomer.address?.zipCode || ''
                },
                phone: activeCustomer.phone || '',
                email: activeCustomer.email || '',
                marketingEmail: activeCustomer.marketingEmail || activeCustomer.email || '',
                receiveMarketing: activeCustomer.receiveMarketing !== undefined ? activeCustomer.receiveMarketing : true,
                notes: activeCustomer.notes || activeCustomer.quickNote || '',
                status: activeCustomer.status || 'Onboarded',
                level: activeCustomer.level || 'Level - 3',
                customerType: activeCustomer.customerType || 'Fabricator',
                modaDisplay: activeCustomer.modaDisplay || 'No',
                modaBinder: activeCustomer.modaBinder || '0'
            });
        } else if (show) {
            setForm({
                customerName: '',
                company: '',
                address: {
                    street: '',
                    city: '',
                    state: '',
                    zipCode: ''
                },
                phone: '',
                email: '',
                marketingEmail: '',
                receiveMarketing: true,
                notes: '',
                status: 'Onboarded',
                level: 'Level - 3',
                customerType: 'Fabricator',
                modaDisplay: 'No',
                modaBinder: '0'
            });
        }
    }, [activeCustomer, show]);

    const startScanner = async () => {
        setScanStatus('camera');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                }
            });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
        } catch (err) {
            console.error('Camera Error:', err);
            alert('Could not access camera. Please ensure permissions are granted.');
            setScanStatus('idle');
        }
    };

    const stopScanner = () => {
        if (videoRef.current && videoRef.current.srcObject) {
            const tracks = videoRef.current.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }
    };

    const captureAndScan = async () => {
        if (!videoRef.current || !canvasRef.current) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = canvas.toDataURL('image/jpeg');
        stopScanner();
        setScanStatus('processing');
        setScanProgress(0);

        try {
            const { data: { text } } = await Tesseract.recognize(
                imageData,
                'eng',
                {
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            setScanProgress(Math.floor(m.progress * 100));
                        }
                    }
                }
            );

            console.log('OCR Raw Text:', text);
            const parsedData = parseBusinessCard(text);
            console.log('Parsed Data:', parsedData);

            let foundSomething = false;
            const updatedForm = { ...form };

            if (parsedData.customerName) { updatedForm.customerName = parsedData.customerName; foundSomething = true; }
            if (parsedData.company) { updatedForm.company = parsedData.company; foundSomething = true; }
            if (parsedData.phone) { updatedForm.phone = parsedData.phone; foundSomething = true; }
            if (parsedData.email) { 
                updatedForm.email = parsedData.email; 
                updatedForm.marketingEmail = parsedData.email; 
                foundSomething = true; 
            }

            if (parsedData.address.street) { updatedForm.address.street = parsedData.address.street; foundSomething = true; }
            if (parsedData.address.city) { updatedForm.address.city = parsedData.address.city; foundSomething = true; }
            if (parsedData.address.state) { updatedForm.address.state = parsedData.address.state; foundSomething = true; }
            if (parsedData.address.zipCode) { updatedForm.address.zipCode = parsedData.address.zipCode; foundSomething = true; }

            if (foundSomething) {
                setForm(updatedForm);
            } else {
                console.warn('Scanner: No recognizable data found in the text.');
                const showRaw = window.confirm('Scanning complete, but no specific contact details could be identified.\n\nWould you like to see the raw text found on the card? This helps us improve the scanner.');
                if (showRaw) {
                    alert(`Raw Text Found:\n\n${text}`);
                }
            }

            setScanStatus('idle');
        } catch (err) {
            console.error('OCR Error:', err);
            alert('Failed to scan card. Please try again.');
            setScanStatus('idle');
        }
    };

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            const imageData = event.target.result;
            setScanStatus('processing');
            setScanProgress(0);

            try {
                const { data: { text } } = await Tesseract.recognize(
                    imageData,
                    'eng',
                    {
                        logger: m => {
                            if (m.status === 'recognizing text') {
                                setScanProgress(Math.floor(m.progress * 100));
                            }
                        }
                    }
                );

                console.log('OCR Raw Text:', text);
                const parsedData = parseBusinessCard(text);
                console.log('Parsed Data:', parsedData);

                let foundSomething = false;
                const updatedForm = { ...form };

                if (parsedData.customerName) { updatedForm.customerName = parsedData.customerName; foundSomething = true; }
                if (parsedData.company) { updatedForm.company = parsedData.company; foundSomething = true; }
                if (parsedData.phone) { updatedForm.phone = parsedData.phone; foundSomething = true; }
                if (parsedData.email) { 
                    updatedForm.email = parsedData.email; 
                    updatedForm.marketingEmail = parsedData.email; 
                    foundSomething = true; 
                }

                if (parsedData.address.street) { updatedForm.address.street = parsedData.address.street; foundSomething = true; }
                if (parsedData.address.city) { updatedForm.address.city = parsedData.address.city; foundSomething = true; }
                if (parsedData.address.state) { updatedForm.address.state = parsedData.address.state; foundSomething = true; }
                if (parsedData.address.zipCode) { updatedForm.address.zipCode = parsedData.address.zipCode; foundSomething = true; }

                if (foundSomething) {
                    setForm(updatedForm);
                } else {
                    console.warn('Scanner: No recognizable data found in the text.');
                    const showRaw = window.confirm('Scanning complete, but no specific contact details could be identified.\n\nWould you like to see the raw text found on the card? This helps us improve the scanner.');
                    if (showRaw) {
                        alert(`Raw Text Found:\n\n${text}`);
                    }
                }

                setScanStatus('idle');
            } catch (err) {
                console.error('OCR Error:', err);
                alert('Failed to scan card image. Please try again.');
                setScanStatus('idle');
            }
        };
        reader.readAsDataURL(file);
    };

    useEffect(() => {
        return () => stopScanner();
    }, []);

    const handleClose = () => {
        setForm({
            customerName: '',
            company: '',
            address: {
                street: '',
                city: '',
                state: '',
                zipCode: ''
            },
            phone: '',
            email: '',
            notes: '',
            status: 'Onboarded',
            level: 'Level - 3',
            customerType: 'Fabricator',
            modaDisplay: 'No',
            modaBinder: '0'
        });
        onClose();
    };

    const handleSave = () => {
        if (!form.company.trim()) {
            alert('Company name is required');
            return;
        }
        onSave(form, handleClose);
    };

    if (!show) return null;

    const isViewMode = !!viewingCustomer;
    const isEditMode = !!editingCustomer;

    return (
        <div className="modal-overlay add-customer-modal-overlay" onClick={handleClose}>
            <div className="modal-content add-customer-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <div className="add-customer-modal-header-actions">
                        <h2>{isViewMode ? 'View Customer' : (isEditMode ? 'Edit Customer' : 'Add New Customer')}</h2>
                        {!isViewMode && (
                            <div className="scan-card-actions">
                                <button
                                    className="scan-card-btn"
                                    onClick={startScanner}
                                    title="Scan Business Card (Camera)"
                                >
                                    <Scan size={14} />
                                    Scan Card
                                </button>
                                <label className="scan-card-btn upload-card-btn">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={handleImageUpload}
                                        style={{ display: 'none' }}
                                    />
                                    <Upload size={14} />
                                    Upload Contact Screenshot
                                </label>
                            </div>
                        )}
                    </div>
                    <button className="close-btn" onClick={handleClose}>
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body">
                    {scanStatus !== 'idle' && (
                        <div className="scan-overlay">
                            {scanStatus === 'camera' ? (
                                <>
                                    <div className="scan-frame">
                                        <video
                                            ref={videoRef}
                                            autoPlay
                                            playsInline
                                            className="scan-video"
                                        />
                                        <div className="scan-guideline" />
                                    </div>
                                    <p className="scan-instruction">
                                        Align ID or business card within the frame
                                    </p>
                                    <div className="scan-action-buttons">
                                        <button
                                            className="btn-secondary scan-cancel-btn"
                                            onClick={() => { stopScanner(); setScanStatus('idle'); }}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            className="btn-primary scan-capture-btn"
                                            onClick={captureAndScan}
                                        >
                                            Capture
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className="scan-processing">
                                    <Loader size={40} className="animate-spin scan-loader" />
                                    <h3 className="scan-processing-title">Processing Document...</h3>
                                    <div className="scan-progress-bar">
                                        <div 
                                            className="scan-progress-fill"
                                            style={{ width: `${scanProgress}%` }}
                                        />
                                    </div>
                                    <p className="scan-progress-text">
                                        {scanProgress}% Processed
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                    <canvas ref={canvasRef} style={{ display: 'none' }} />
                    
                    <div className="form-grid-2col">
                        <div className="form-group">
                            <label>Company Name <span style={{ color: 'red' }}>*</span></label>
                            <input
                                type="text"
                                value={form.company}
                                onChange={(e) => setForm({ ...form, company: e.target.value })}
                                placeholder="Enter company name"
                                disabled={isViewMode}
                                autoFocus={!isViewMode && !isEditMode}
                            />
                        </div>
                        <div className="form-group">
                            <label>Contact Name</label>
                            <input
                                type="text"
                                value={form.customerName}
                                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                                placeholder="Contact person name"
                                disabled={isViewMode}
                            />
                        </div>
                    </div>

                    <div className="form-grid-2col">
                        <div className="form-group">
                            <label>Phone</label>
                            <input
                                type="tel"
                                value={form.phone}
                                onChange={(e) => setForm({ ...form, phone: formatPhoneInput(e.target.value) })}
                                placeholder="(555) 000-0000"
                                disabled={isViewMode}
                            />
                        </div>
                        <div className="form-group">
                            <label>Email</label>
                            <input
                                type="email"
                                value={form.email}
                                onChange={(e) => setForm({ ...form, email: e.target.value })}
                                placeholder="Email address"
                                disabled={isViewMode}
                            />
                        </div>
                    </div>

                    <div className="form-grid-2col">
                        <div className="form-group">
                            <label>Marketing Email</label>
                            <input
                                type="email"
                                value={form.marketingEmail}
                                onChange={(e) => setForm({ ...form, marketingEmail: e.target.value })}
                                placeholder={form.email || "Marketing Email address"}
                                disabled={isViewMode}
                            />
                        </div>
                        <div className="form-group marketing-optin-group">
                            <label className="marketing-optin-label" style={{ cursor: isViewMode ? 'default' : 'pointer' }}>
                                <div 
                                    onClick={() => !isViewMode && setForm({ ...form, receiveMarketing: !form.receiveMarketing })}
                                    className={`marketing-optin-checkbox ${form.receiveMarketing ? 'optin-active' : 'optin-inactive'}`}
                                    style={{ cursor: isViewMode ? 'default' : 'pointer' }}
                                >
                                    {form.receiveMarketing ? '✓' : '✕'}
                                </div>
                                <span className="marketing-optin-text">Receive Marketing Emails</span>
                            </label>
                        </div>
                    </div>

                    <div className="form-grid-2col">
                        <div className="form-group">
                            <label>Status</label>
                            <select
                                className="form-select"
                                value={form.status}
                                onChange={(e) => setForm({ ...form, status: e.target.value })}
                                disabled={isViewMode}
                            >
                                <option value="New Lead">New Lead</option>
                                <option value="Trying to Onboard">Trying to Onboard</option>
                                <option value="Contacted / In Discussion">Contacted / In Discussion</option>
                                <option value="Onboarded">Onboarded</option>
                                <option value="Different Sales Person">Different Sales Person</option>
                                <option value="Not Interested">Not Interested</option>
                                <option value="Inactive">Inactive</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Level</label>
                            <select
                                className="form-select"
                                value={form.level}
                                onChange={(e) => setForm({ ...form, level: e.target.value })}
                                disabled={isViewMode}
                            >
                                <option value="Level - 1">Level 1</option>
                                <option value="Level - 2">Level 2</option>
                                <option value="Level - 3">Level 3</option>
                                <option value="Level - 4">Level 4</option>
                            </select>
                        </div>
                    </div>

                    <div className="form-grid-3col">
                        <div className="form-group">
                            <label>Customer Type</label>
                            <select
                                className="form-select"
                                value={form.customerType}
                                onChange={(e) => setForm({ ...form, customerType: e.target.value })}
                                disabled={isViewMode}
                            >
                                <option value="Fabricator">Fabricator</option>
                                <option value="Contractor">Contractor</option>
                                <option value="Dealer">Dealer</option>
                                <option value="Floor Covering">Floor Covering</option>
                                <option value="Designer">Designer</option>
                                <option value="Builder">Builder</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Moda Display</label>
                            <select
                                className="form-select"
                                value={form.modaDisplay}
                                onChange={(e) => setForm({ ...form, modaDisplay: e.target.value })}
                                disabled={isViewMode}
                            >
                                <option value="No">No</option>
                                <option value="Yes">Yes</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Moda Binder</label>
                            <input
                                type="text"
                                value={form.modaBinder}
                                onChange={(e) => setForm({ ...form, modaBinder: e.target.value })}
                                placeholder="Qty/Note"
                                disabled={isViewMode}
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Address</label>
                        <input
                            type="text"
                            value={form.address.street}
                            onChange={(e) => setForm({ ...form, address: { ...form.address, street: e.target.value } })}
                            placeholder="Street Address"
                            disabled={isViewMode}
                            className="margin-bottom-sm"
                        />
                        <div className="address-row-grid">
                            <input
                                type="text"
                                value={form.address.city}
                                onChange={(e) => setForm({ ...form, address: { ...form.address, city: e.target.value } })}
                                placeholder="City"
                                disabled={isViewMode}
                            />
                            <input
                                type="text"
                                value={form.address.state}
                                onChange={(e) => setForm({ ...form, address: { ...form.address, state: e.target.value } })}
                                placeholder="State"
                                disabled={isViewMode}
                            />
                            <input
                                type="text"
                                value={form.address.zipCode}
                                onChange={(e) => setForm({ ...form, address: { ...form.address, zipCode: e.target.value } })}
                                placeholder="ZIP"
                                disabled={isViewMode}
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Notes</label>
                        <textarea
                            value={form.notes}
                            onChange={(e) => setForm({ ...form, notes: e.target.value })}
                            placeholder="Any additional notes..."
                            disabled={isViewMode}
                            rows="3"
                        />
                    </div>
                </div>
                <div className="modal-footer">
                    {isViewMode ? (
                        <button className="btn-primary" onClick={handleClose}>
                            Close
                        </button>
                    ) : (
                        <>
                            <button className="btn-secondary" onClick={handleClose} disabled={isSaving}>
                                Cancel
                            </button>
                            <button className="btn-primary" onClick={handleSave} disabled={isSaving}>
                                {isSaving ? (
                                    <><Loader size={14} className="animate-spin margin-right-sm" /> Saving...</>
                                ) : (
                                    isEditMode ? 'Save Changes' : 'Add Customer'
                                )}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AddCustomerModal;
