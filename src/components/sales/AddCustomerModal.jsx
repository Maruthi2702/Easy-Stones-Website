import React, { useState, useRef, useEffect } from 'react';
import { X, Loader, Camera, Scan, RotateCcw, Check } from 'lucide-react';
import Tesseract from 'tesseract.js';
import { formatPhoneInput } from '../../utils/phoneUtils';
import { parseBusinessCard } from '../../utils/cardParser';

const AddCustomerModal = ({ show, onClose, onSave, isSaving }) => {
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
        notes: '',
        status: 'active'
    });

    const [isScanning, setIsScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState(0);
    const [scanStatus, setScanStatus] = useState('idle'); // 'idle', 'camera', 'processing'
    const videoRef = useRef(null);
    const canvasRef = useRef(null);

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
            if (parsedData.email) { updatedForm.email = parsedData.email; foundSomething = true; }

            if (parsedData.address.street) { updatedForm.address.street = parsedData.address.street; foundSomething = true; }
            if (parsedData.address.city) { updatedForm.address.city = parsedData.address.city; foundSomething = true; }
            if (parsedData.address.state) { updatedForm.address.state = parsedData.address.state; foundSomething = true; }
            if (parsedData.address.zipCode) { updatedForm.address.zipCode = parsedData.address.zipCode; foundSomething = true; }

            if (foundSomething) {
                setForm(updatedForm);
            } else {
                console.warn('Scanner: No recognizable data found in the text.');
                // Show raw text in a prompt so user can copy it for us to debug
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
            status: 'active'
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

    return (
        <div className="modal-overlay add-customer-modal-overlay" onClick={handleClose} style={{ zIndex: 20000 }}>
            <div className="modal-content add-customer-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
                <div className="modal-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <h2>Add New Customer</h2>
                        <button
                            className="scan-card-btn"
                            onClick={startScanner}
                            title="Scan Business Card"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                padding: '0.4rem 0.8rem',
                                borderRadius: '20px',
                                border: '1px solid #3b82f6',
                                background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                                color: '#1d4ed8',
                                fontSize: '0.8rem',
                                fontWeight: '600',
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                        >
                            <Scan size={14} />
                            Scan Card
                        </button>
                    </div>
                    <button className="close-btn" onClick={handleClose}>
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body" style={{ position: 'relative' }}>
                    {scanStatus !== 'idle' && (
                        <div style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: 'rgba(0,0,0,0.9)',
                            zIndex: 10,
                            borderRadius: '0 0 12px 12px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            padding: '1rem'
                        }}>
                            {scanStatus === 'camera' ? (
                                <>
                                    <div style={{
                                        width: '100%',
                                        maxWidth: '400px',
                                        aspectRatio: '1.6',
                                        border: '2px dashed #3b82f6',
                                        borderRadius: '8px',
                                        position: 'relative',
                                        overflow: 'hidden',
                                        marginBottom: '1rem'
                                    }}>
                                        <video
                                            ref={videoRef}
                                            autoPlay
                                            playsInline
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        />
                                        <div style={{
                                            position: 'absolute',
                                            top: '50%',
                                            left: '50%',
                                            transform: 'translate(-50%, -50%)',
                                            width: '80%',
                                            height: '60%',
                                            border: '2px solid rgba(255,255,255,0.3)',
                                            pointerEvents: 'none'
                                        }} />
                                    </div>
                                    <p style={{ fontSize: '0.85rem', marginBottom: '1.5rem', opacity: 0.8 }}>
                                        Align business card within the frame
                                    </p>
                                    <div style={{ display: 'flex', gap: '1rem' }}>
                                        <button
                                            className="btn-secondary"
                                            onClick={() => { stopScanner(); setScanStatus('idle'); }}
                                            style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none' }}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            className="btn-primary"
                                            onClick={captureAndScan}
                                            style={{ background: '#3b82f6', border: 'none', padding: '0.75rem 2rem' }}
                                        >
                                            Capture
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div style={{ textAlign: 'center' }}>
                                    <Loader size={40} className="animate-spin" style={{ marginBottom: '1rem', color: '#3b82f6' }} />
                                    <h3 style={{ marginBottom: '0.5rem' }}>Scanning Card...</h3>
                                    <div style={{
                                        width: '200px',
                                        height: '6px',
                                        backgroundColor: 'rgba(255,255,255,0.1)',
                                        borderRadius: '3px',
                                        overflow: 'hidden'
                                    }}>
                                        <div style={{
                                            width: `${scanProgress}%`,
                                            height: '100%',
                                            backgroundColor: '#3b82f6',
                                            transition: 'width 0.3s'
                                        }} />
                                    </div>
                                    <p style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.6 }}>
                                        {scanProgress}% Processed
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                    <canvas ref={canvasRef} style={{ display: 'none' }} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div className="form-group">
                            <label>Company Name <span style={{ color: 'red' }}>*</span></label>
                            <input
                                type="text"
                                value={form.company}
                                onChange={(e) => setForm({ ...form, company: e.target.value })}
                                placeholder="Enter company name"
                                autoFocus
                            />
                        </div>
                        <div className="form-group">
                            <label>Customer Name</label>
                            <input
                                type="text"
                                value={form.customerName}
                                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                                placeholder="Contact person name"
                            />
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div className="form-group">
                            <label>Phone</label>
                            <input
                                type="tel"
                                value={form.phone}
                                onChange={(e) => setForm({ ...form, phone: formatPhoneInput(e.target.value) })}
                                placeholder="(555) 000-0000"
                            />
                        </div>
                        <div className="form-group">
                            <label>Email</label>
                            <input
                                type="email"
                                value={form.email}
                                onChange={(e) => setForm({ ...form, email: e.target.value })}
                                placeholder="Email address"
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
                            style={{ marginBottom: '0.5rem' }}
                        />
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.5rem' }}>
                            <input
                                type="text"
                                value={form.address.city}
                                onChange={(e) => setForm({ ...form, address: { ...form.address, city: e.target.value } })}
                                placeholder="City"
                            />
                            <input
                                type="text"
                                value={form.address.state}
                                onChange={(e) => setForm({ ...form, address: { ...form.address, state: e.target.value } })}
                                placeholder="State"
                            />
                            <input
                                type="text"
                                value={form.address.zipCode}
                                onChange={(e) => setForm({ ...form, address: { ...form.address, zipCode: e.target.value } })}
                                placeholder="ZIP"
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Notes</label>
                        <textarea
                            value={form.notes}
                            onChange={(e) => setForm({ ...form, notes: e.target.value })}
                            placeholder="Any additional notes..."
                            rows="3"
                        />
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn-secondary" onClick={handleClose} disabled={isSaving}>
                        Cancel
                    </button>
                    <button className="btn-primary" onClick={handleSave} disabled={isSaving}>
                        {isSaving ? (
                            <><Loader size={14} className="animate-spin" style={{ marginRight: '0.5rem' }} /> Saving...</>
                        ) : (
                            'Add Customer'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};


export default AddCustomerModal;
