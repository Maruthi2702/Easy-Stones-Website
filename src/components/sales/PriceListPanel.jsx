import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Search, Printer, Tag, FileText, LayoutGrid, RotateCcw, Download } from 'lucide-react';
import './PriceListPanel.css';

// Exact Static Data from the PDF Price List (Initial Defaults)
const defaultPriceListData = [
    {
        collection: 'Signature',
        subgroups: [
            {
                price3cm: '$7.95',
                price2cm: '$6.50',
                items: [
                    { name: 'Elusive White', size: '139x78' },
                    { name: 'Feather White', size: '139x78' },
                    { name: 'Crystal', size: '139x78' },
                    { name: 'Olympic', size: '139x78' }
                ]
            },
            {
                price3cm: '$8.50',
                price2cm: '$7.95',
                items: [
                    { name: 'Chinook Grey', size: '135x77' },
                    { name: 'Carrara Deluxe', size: '135x77' },
                    { name: 'Carrara Prima', size: '135x77' },
                    { name: 'Carrara Prima Gold', size: '135x77' }
                ]
            },
            {
                price3cm: '$9.95',
                price2cm: '$8.95',
                items: [
                    { name: 'Designer White', size: '140x81' },
                    { name: 'Bianco Carrara', size: '138x79' },
                    { name: 'Mystique', size: '138x79' },
                    { name: 'Cascada', size: '136x78' },
                    { name: 'Cosmic', size: '126x63' }
                ]
            },
            {
                price3cm: '$10.95',
                price2cm: '$9.95',
                items: [
                    { name: 'Himalaya White', size: '139x78' },
                    { name: 'Manatee', size: '126x63' },
                    { name: 'Sandstone', size: '126x63' }
                ]
            }
        ]
    },
    {
        collection: 'Prestige',
        subgroups: [
            {
                price3cm: '$12.95',
                price2cm: '$10.95',
                items: [
                    { name: 'Enigma', size: '126x63, 142x79' },
                    { name: 'Enigma Gold', size: '126x63, 142x79' },
                    { name: 'Giotto', size: '126x63, 142x79' },
                    { name: 'Giotto Oro', size: '126x63, 142x79' },
                    { name: 'Calacatta Mia', size: '126x63, 139x80' },
                    { name: 'Shadow', size: '126x63, 136x78' },
                    { name: 'Shadow Gold', size: '126x63, 136x78' }
                ]
            }
        ]
    },
    {
        collection: 'Luxe',
        subgroups: [
            {
                price3cm: '$16.50',
                price2cm: 'Special Order',
                items: [
                    { name: 'Calacatta Zurrich', size: '136x78' },
                    { name: 'Calacatta Bella Nuo', size: '138x79' },
                    { name: 'Pitch Black', size: '126x63' },
                    { name: 'Calacatta Savoy', size: '136x78' },
                    { name: 'Calacatta Lincoln', size: '126x63' },
                    { name: 'Nero Marquina', size: '126x63' },
                    { name: 'Carbon Matte', size: '139x80' }
                ]
            },
            {
                price3cm: '$19.50',
                price2cm: 'Special Order',
                items: [
                    { name: 'Statuario Dorato', size: '126x63' },
                    { name: 'Calacatta Venus', size: '138x79' },
                    { name: 'Calacatta Umi', size: '138x79' },
                    { name: 'Calacatta Wow', size: '138x79' },
                    { name: 'Calacatta Ibiza', size: '138x79' },
                    { name: 'Calacatta Venato', size: '126x63' },
                    { name: 'Calacatta Rama', size: '126x63' },
                    { name: 'Calacatta Sole', size: '126x63' },
                    { name: 'Calacatta Nero', size: '126x63' }
                ]
            },
            {
                price3cm: '$22.50',
                price2cm: 'Special Order',
                items: [
                    { name: 'Sonoma', size: '138x79' },
                    { name: 'Statuary Waves', size: '126x63' },
                    { name: 'Mykonos', size: '138x79' },
                    { name: 'Panda', size: '126x63' }
                ]
            },
            {
                price3cm: '$26.50',
                price2cm: 'Special Order',
                items: [
                    { name: 'Arabesco Croma', size: '138x79' },
                    { name: 'Arabesco Verde', size: '138x79' },
                    { name: 'Perla Oro', size: '138x79' },
                    { name: 'Statuario Opus', size: '138x79' },
                    { name: 'Statuario Piedmont', size: '138x79' },
                    { name: 'Travete Harvest', size: '138x79' },
                    { name: 'Travete Giaco', size: '138x79' },
                    { name: 'Travete Tempest', size: '138x79' }
                ]
            },
            {
                price3cm: '$28.50',
                price2cm: 'Special Order',
                items: [
                    { name: 'Statuario Fantasia', size: '138x79' },
                    { name: 'Statuario Marina', size: '138x79' },
                    { name: 'Calacatta Tesoro', size: '138x79' },
                    { name: 'Luxor Oro', size: '138x79' }
                ]
            }
        ]
    },
    {
        collection: 'ThruTeQ',
        subgroups: [
            {
                price3cm: '$21.50',
                price2cm: 'Special Order',
                items: [
                    { name: 'Taj Augusta', size: '138x79' }
                ]
            },
            {
                price3cm: '$24.50',
                price2cm: 'Special Order',
                items: [
                    { name: 'Taj Mahal PST Face T', size: '138x79' }
                ]
            }
        ]
    }
];

const PriceListPanel = ({ sidebarToggle }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState('document'); // 'document' (exact PDF style) or 'flat'

    // Editable state loading from localStorage if present
    const [sheetData, setSheetData] = useState(() => {
        try {
            const saved = localStorage.getItem('cached_editable_pricelist');
            return saved ? JSON.parse(saved) : defaultPriceListData;
        } catch (e) {
            return defaultPriceListData;
        }
    });

    // Handle editing cell values dynamically
    const handleCellChange = (colIdx, subIdx, itemIdx, field, value) => {
        setSheetData(prevData => {
            const newData = JSON.parse(JSON.stringify(prevData));
            if (field === 'price3cm' || field === 'price2cm') {
                newData[colIdx].subgroups[subIdx][field] = value;
            } else if (itemIdx !== null) {
                newData[colIdx].subgroups[subIdx].items[itemIdx][field] = value;
            }
            try {
                localStorage.setItem('cached_editable_pricelist', JSON.stringify(newData));
            } catch (e) {
                console.warn('Failed to cache edited pricelist', e);
            }
            return newData;
        });
    };

    // Handle collection name editing
    const handleCollectionNameChange = (colIdx, value) => {
        setSheetData(prevData => {
            const newData = JSON.parse(JSON.stringify(prevData));
            newData[colIdx].collection = value;
            try {
                localStorage.setItem('cached_editable_pricelist', JSON.stringify(newData));
            } catch (e) {
                console.warn('Failed to cache edited pricelist', e);
            }
            return newData;
        });
    };

    // Reset edits to original defaults
    const handleReset = () => {
        if (window.confirm("Are you sure you want to discard all edits and reset the Price List back to original PDF prices?")) {
            setSheetData(defaultPriceListData);
            try {
                localStorage.removeItem('cached_editable_pricelist');
            } catch (e) {}
        }
    };

    // Flat list representation of all items for searching and sorting
    const flatItems = useMemo(() => {
        const list = [];
        sheetData.forEach((col, colIdx) => {
            col.subgroups.forEach((sub, subIdx) => {
                sub.items.forEach((item, itemIdx) => {
                    list.push({
                        name: item.name,
                        size: item.size,
                        price3cm: sub.price3cm,
                        price2cm: sub.price2cm,
                        collection: col.collection,
                        colIdx,
                        subIdx,
                        itemIdx
                    });
                });
            });
        });
        return list;
    }, [sheetData]);

    // Filter flat list items when search is active
    const filteredFlatItems = useMemo(() => {
        if (!searchTerm.trim()) return flatItems;
        const s = searchTerm.toLowerCase();
        return flatItems.filter(item => 
            item.name.toLowerCase().includes(s) ||
            item.collection.toLowerCase().includes(s) ||
            item.size.toLowerCase().includes(s)
        );
    }, [flatItems, searchTerm]);

    const handlePrint = () => {
        window.print();
    };

    // Export current active edits to Excel (.xlsx) file
    const handleExportExcel = () => {
        try {
            const list = [];
            sheetData.forEach(col => {
                col.subgroups.forEach(sub => {
                    sub.items.forEach(item => {
                        list.push({
                            'Color / Material Name': item.name,
                            '3CM Price': sub.price3cm,
                            '2CM Price': sub.price2cm,
                            'Slab Size': item.size,
                            'Collection Name': col.collection
                        });
                    });
                });
            });

            const worksheet = XLSX.utils.json_to_sheet(list);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Quartz Price List');
            
            // Generate filename based on date
            const dateStr = new Date().toISOString().split('T')[0];
            XLSX.writeFile(workbook, `Moda_Quartz_PriceList_${dateStr}.xlsx`);
        } catch (error) {
            console.error('Error exporting Price List to Excel:', error);
            alert('Failed to export data to Excel file');
        }
    };

    // Calculate total rows in a collection for rowSpan calculations
    const getCollectionTotalRows = (col) => {
        let total = 0;
        col.subgroups.forEach(sub => {
            total += sub.items.length;
        });
        return total;
    };

    // Check if an item matches search term (used for highlighting in document view)
    const isMatched = (name, collection) => {
        if (!searchTerm.trim()) return false;
        const s = searchTerm.toLowerCase();
        return name.toLowerCase().includes(s) || collection.toLowerCase().includes(s);
    };

    return (
        <div className="pdf-plp-root">
            {/* Top Toolbar controls (non-printable) */}
            <div className="pdf-plp-toolbar no-print">
                <div className="toolbar-left">
                    {sidebarToggle}
                    <div className="toolbar-icon">
                        <Tag size={18} />
                    </div>
                    <div>
                        <h2 className="toolbar-title">Confidential Pricing Sheet</h2>
                        <p className="toolbar-subtitle">Double-click or click cells directly to edit prices and sizes in real-time</p>
                    </div>
                </div>

                <div className="toolbar-actions">
                    <div className="toolbar-search-wrap">
                        <Search size={14} className="toolbar-search-icon" />
                        <input
                            type="text"
                            className="toolbar-search-input"
                            placeholder="Quick search colors..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <div className="toolbar-toggle-btns">
                        <button
                            onClick={() => setViewMode('document')}
                            className={`toolbar-btn ${viewMode === 'document' ? 'active' : ''}`}
                            title="Exact PDF Document View"
                        >
                            <FileText size={15} />
                            <span>PDF Layout</span>
                        </button>
                        <button
                            onClick={() => setViewMode('flat')}
                            className={`toolbar-btn ${viewMode === 'flat' ? 'active' : ''}`}
                            title="Flat Spreadsheet Catalog View"
                        >
                            <LayoutGrid size={15} />
                            <span>Catalog List</span>
                        </button>
                    </div>

                    <button className="toolbar-action-icon-btn reset" onClick={handleReset} title="Reset to Defaults">
                        <RotateCcw size={15} />
                        <span>Reset</span>
                    </button>

                    <button className="toolbar-action-icon-btn export" onClick={handleExportExcel} title="Export to Excel File">
                        <Download size={15} />
                        <span>Export</span>
                    </button>

                    <button className="toolbar-print-btn" onClick={handlePrint} title="Print/Save as PDF">
                        <Printer size={15} />
                        <span>Print / PDF</span>
                    </button>
                </div>
            </div>

            {/* Document sheet body */}
            <div className="pdf-sheet-wrapper">
                {viewMode === 'document' ? (
                    /* ── EXACT PDF LAYOUT ── */
                    <div className="pdf-document-container">
                        {/* Page 1 */}
                        <div className="pdf-page-container">
                            {/* Page header metadata */}
                            <div className="pdf-page-metadata-header">
                                <span className="meta-confidential">Easy Stones Confidential Pricing MQESQ22026 by collection</span>
                                <span className="meta-page-number">1 of 2</span>
                                <span className="meta-publish-date">published 04/15/2026</span>
                            </div>

                            {/* Letterhead Header row */}
                            <div className="pdf-letterhead">
                                <div className="letterhead-logo-box">
                                    <h1 className="logo-title">MODA</h1>
                                    <div className="logo-divider-wrap">
                                        <div className="logo-line"></div>
                                        <span className="logo-subtitle">QUARTZ</span>
                                        <div className="logo-line"></div>
                                    </div>
                                </div>

                                <div className="letterhead-contact-info">
                                    <span className="contact-phone">253 514 3348</span>
                                    <span className="contact-email">krish@easystones.com</span>
                                    <span className="contact-address">6012 S 196th St,</span>
                                    <span className="contact-city">Kent, WA 98032</span>
                                    <span className="contact-website">www.easystones.com</span>
                                </div>

                                <div className="letterhead-distribution">
                                    <span className="dist-label">Distributed by</span>
                                    <div className="dist-logo-wrap">
                                        <div className="dist-parallel-bars">
                                            <div className="bar bar1"></div>
                                            <div className="bar bar2"></div>
                                            <div className="bar bar3"></div>
                                        </div>
                                        <span className="dist-company-name">EASY STONES</span>
                                    </div>
                                </div>
                            </div>

                            {/* Prices Table */}
                            <div className="pdf-table-wrapper">
                                <table className="pdf-exact-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: '32%' }}>Color</th>
                                            <th style={{ width: '12%' }}>3CM</th>
                                            <th style={{ width: '12%' }}>2CM</th>
                                            <th style={{ width: '32%' }}>
                                                <div className="table-header-double-label">
                                                    <span className="main-lbl">Slab Size</span>
                                                    <span className="sub-lbl">confirm size & availability prior to ordering</span>
                                                </div>
                                            </th>
                                            <th style={{ width: '12%' }}>Collection</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {/* Signature Collection (All 4 subgroups) */}
                                        {(() => {
                                            const sigColIdx = sheetData.findIndex(c => c.collection === 'Signature' || c.collection === 'Signature Collection');
                                            const sigCol = sheetData[sigColIdx];
                                            if (!sigCol) return null;
                                            const renderedRows = [];
                                            let hasRenderedCollection = false;

                                            sigCol.subgroups.forEach((sub, subIdx) => {
                                                sub.items.forEach((item, itemIdx) => {
                                                    const isFirstItemInSub = itemIdx === 0;
                                                    const highlight = isMatched(item.name, sigCol.collection);

                                                    renderedRows.push(
                                                        <tr key={`sig-${subIdx}-${itemIdx}`} className={highlight ? 'pl-row-highlight' : ''}>
                                                            <td className="exact-color-cell">
                                                                <input
                                                                    type="text"
                                                                    value={item.name}
                                                                    onChange={(e) => handleCellChange(sigColIdx, subIdx, itemIdx, 'name', e.target.value)}
                                                                    className="exact-input-cell text-left font-semibold"
                                                                />
                                                            </td>
                                                            {isFirstItemInSub && (
                                                                <td className="exact-price-cell text-center" rowSpan={sub.items.length}>
                                                                    <input
                                                                        type="text"
                                                                        value={sub.price3cm}
                                                                        onChange={(e) => handleCellChange(sigColIdx, subIdx, null, 'price3cm', e.target.value)}
                                                                        className="exact-input-cell text-center font-bold"
                                                                    />
                                                                </td>
                                                            )}
                                                            {isFirstItemInSub && (
                                                                <td className="exact-price-cell text-center" rowSpan={sub.items.length}>
                                                                    <input
                                                                        type="text"
                                                                        value={sub.price2cm}
                                                                        onChange={(e) => handleCellChange(sigColIdx, subIdx, null, 'price2cm', e.target.value)}
                                                                        className="exact-input-cell text-center font-bold"
                                                                    />
                                                                </td>
                                                            )}
                                                            <td className="exact-size-cell text-center">
                                                                <input
                                                                    type="text"
                                                                    value={item.size}
                                                                    onChange={(e) => handleCellChange(sigColIdx, subIdx, itemIdx, 'size', e.target.value)}
                                                                    className="exact-input-cell text-center font-medium"
                                                                />
                                                            </td>
                                                            {!hasRenderedCollection && isFirstItemInSub && (
                                                                <td className="exact-collection-cell text-center font-bold" rowSpan={getCollectionTotalRows(sigCol)}>
                                                                    <input
                                                                        type="text"
                                                                        value={sigCol.collection}
                                                                        onChange={(e) => handleCollectionNameChange(sigColIdx, e.target.value)}
                                                                        className="exact-input-cell text-center font-bold"
                                                                    />
                                                                </td>
                                                            )}
                                                        </tr>
                                                    );
                                                    if (isFirstItemInSub) hasRenderedCollection = true;
                                                });
                                            });
                                            return renderedRows;
                                        })()}

                                        {/* Prestige Collection */}
                                        {(() => {
                                            const presColIdx = sheetData.findIndex(c => c.collection === 'Prestige');
                                            const presCol = sheetData[presColIdx];
                                            if (!presCol) return null;
                                            const renderedRows = [];
                                            let hasRenderedCollection = false;

                                            presCol.subgroups.forEach((sub, subIdx) => {
                                                sub.items.forEach((item, itemIdx) => {
                                                    const isFirstItemInSub = itemIdx === 0;
                                                    const highlight = isMatched(item.name, presCol.collection);

                                                    renderedRows.push(
                                                        <tr key={`pres-${subIdx}-${itemIdx}`} className={highlight ? 'pl-row-highlight' : ''}>
                                                            <td className="exact-color-cell">
                                                                <input
                                                                    type="text"
                                                                    value={item.name}
                                                                    onChange={(e) => handleCellChange(presColIdx, subIdx, itemIdx, 'name', e.target.value)}
                                                                    className="exact-input-cell text-left font-semibold"
                                                                />
                                                            </td>
                                                            {isFirstItemInSub && (
                                                                <td className="exact-price-cell text-center" rowSpan={sub.items.length}>
                                                                    <input
                                                                        type="text"
                                                                        value={sub.price3cm}
                                                                        onChange={(e) => handleCellChange(presColIdx, subIdx, null, 'price3cm', e.target.value)}
                                                                        className="exact-input-cell text-center font-bold"
                                                                    />
                                                                </td>
                                                            )}
                                                            {isFirstItemInSub && (
                                                                <td className="exact-price-cell text-center" rowSpan={sub.items.length}>
                                                                    <input
                                                                        type="text"
                                                                        value={sub.price2cm}
                                                                        onChange={(e) => handleCellChange(presColIdx, subIdx, null, 'price2cm', e.target.value)}
                                                                        className="exact-input-cell text-center font-bold"
                                                                    />
                                                                </td>
                                                            )}
                                                            <td className="exact-size-cell text-center">
                                                                <input
                                                                    type="text"
                                                                    value={item.size}
                                                                    onChange={(e) => handleCellChange(presColIdx, subIdx, itemIdx, 'size', e.target.value)}
                                                                    className="exact-input-cell text-center font-medium"
                                                                />
                                                            </td>
                                                            {!hasRenderedCollection && isFirstItemInSub && (
                                                                <td className="exact-collection-cell text-center font-bold" rowSpan={getCollectionTotalRows(presCol)}>
                                                                    <input
                                                                        type="text"
                                                                        value={presCol.collection}
                                                                        onChange={(e) => handleCollectionNameChange(presColIdx, e.target.value)}
                                                                        className="exact-input-cell text-center font-bold"
                                                                    />
                                                                </td>
                                                            )}
                                                        </tr>
                                                    );
                                                    if (isFirstItemInSub) hasRenderedCollection = true;
                                                });
                                            });
                                            return renderedRows;
                                        })()}

                                        {/* Luxe Collection (Subgroup 1 & 2 - Renders on Page 1 in PDF) */}
                                        {(() => {
                                            const luxeColIdx = sheetData.findIndex(c => c.collection === 'Luxe');
                                            const luxeCol = sheetData[luxeColIdx];
                                            if (!luxeCol) return null;
                                            const renderedRows = [];
                                            let hasRenderedCollection = false;

                                            // Render only Subgroup 1 & Subgroup 2 on Page 1
                                            luxeCol.subgroups.slice(0, 2).forEach((sub, subIdx) => {
                                                sub.items.forEach((item, itemIdx) => {
                                                    const isFirstItemInSub = itemIdx === 0;
                                                    const highlight = isMatched(item.name, luxeCol.collection);

                                                    renderedRows.push(
                                                        <tr key={`luxe-p1-${subIdx}-${itemIdx}`} className={highlight ? 'pl-row-highlight' : ''}>
                                                            <td className="exact-color-cell">
                                                                <input
                                                                    type="text"
                                                                    value={item.name}
                                                                    onChange={(e) => handleCellChange(luxeColIdx, subIdx, itemIdx, 'name', e.target.value)}
                                                                    className="exact-input-cell text-left font-semibold"
                                                                />
                                                            </td>
                                                            {isFirstItemInSub && (
                                                                <td className="exact-price-cell text-center" rowSpan={sub.items.length}>
                                                                    <input
                                                                        type="text"
                                                                        value={sub.price3cm}
                                                                        onChange={(e) => handleCellChange(luxeColIdx, subIdx, null, 'price3cm', e.target.value)}
                                                                        className="exact-input-cell text-center font-bold"
                                                                    />
                                                                </td>
                                                            )}
                                                            {isFirstItemInSub && (
                                                                <td className="exact-price-cell text-center" rowSpan={sub.items.length}>
                                                                    <input
                                                                        type="text"
                                                                        value={sub.price2cm}
                                                                        onChange={(e) => handleCellChange(luxeColIdx, subIdx, null, 'price2cm', e.target.value)}
                                                                        className="exact-input-cell text-center font-bold"
                                                                    />
                                                                </td>
                                                            )}
                                                            <td className="exact-size-cell text-center">
                                                                <input
                                                                    type="text"
                                                                    value={item.size}
                                                                    onChange={(e) => handleCellChange(luxeColIdx, subIdx, itemIdx, 'size', e.target.value)}
                                                                    className="exact-input-cell text-center font-medium"
                                                                />
                                                            </td>
                                                            {!hasRenderedCollection && isFirstItemInSub && (
                                                                <td className="exact-collection-cell text-center font-bold" rowSpan={16}> {/* rowSpan 16 is for group 1 (7 items) + group 2 (9 items) */}
                                                                    <input
                                                                        type="text"
                                                                        value={luxeCol.collection}
                                                                        onChange={(e) => handleCollectionNameChange(luxeColIdx, e.target.value)}
                                                                        className="exact-input-cell text-center font-bold"
                                                                    />
                                                                </td>
                                                            )}
                                                        </tr>
                                                    );
                                                    if (isFirstItemInSub) hasRenderedCollection = true;
                                                });
                                            });
                                            return renderedRows;
                                        })()}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Page Break for Printable format */}
                        <div className="pdf-page-break-divider no-print">PAGE 2 BELOW</div>

                        {/* Page 2 */}
                        <div className="pdf-page-container">
                            {/* Page header metadata */}
                            <div className="pdf-page-metadata-header">
                                <span className="meta-confidential">Easy Stones Confidential Pricing MQESQ22026 by collection</span>
                                <span className="meta-page-number">2 of 2</span>
                                <span className="meta-publish-date">published 04/15/2026</span>
                            </div>

                            {/* Letterhead Header row */}
                            <div className="pdf-letterhead">
                                <div className="pdf-letterhead-inner-wrap" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div className="letterhead-logo-box">
                                        <h1 className="logo-title">MODA</h1>
                                        <div className="logo-divider-wrap">
                                            <div className="logo-line"></div>
                                            <span className="logo-subtitle">QUARTZ</span>
                                            <div className="logo-line"></div>
                                        </div>
                                    </div>

                                    <div className="letterhead-contact-info">
                                        <span className="contact-phone">253 514 3348</span>
                                        <span className="contact-email">krish@easystones.com</span>
                                        <span className="contact-address">6012 S 196th St,</span>
                                        <span className="contact-city">Kent, WA 98032</span>
                                        <span className="contact-website">www.easystones.com</span>
                                    </div>

                                    <div className="letterhead-distribution">
                                        <span className="dist-label">Distributed by</span>
                                        <div className="dist-logo-wrap">
                                            <div className="dist-parallel-bars">
                                                <div className="bar bar1"></div>
                                                <div className="bar bar2"></div>
                                                <div className="bar bar3"></div>
                                            </div>
                                            <span className="dist-company-name">EASY STONES</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Page 2 Prices Table */}
                            <div className="pdf-table-wrapper">
                                <table className="pdf-exact-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: '32%' }}>Color</th>
                                            <th style={{ width: '12%' }}>3CM</th>
                                            <th style={{ width: '12%' }}>2CM</th>
                                            <th style={{ width: '32%' }}>
                                                <div className="table-header-double-label">
                                                    <span className="main-lbl">Slab Size</span>
                                                    <span className="sub-lbl">confirm size & availability prior to ordering</span>
                                                </div>
                                            </th>
                                            <th style={{ width: '12%' }}>Collection</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {/* Luxe Collection (Subgroup 3, 4, 5 - Renders on Page 2 in PDF) */}
                                        {(() => {
                                            const luxeColIdx = sheetData.findIndex(c => c.collection === 'Luxe');
                                            const luxeCol = sheetData[luxeColIdx];
                                            if (!luxeCol) return null;
                                            const renderedRows = [];
                                            let hasRenderedCollection = false;

                                            // Render Subgroup 3, 4, and 5 (Subgroups slice from index 2 onwards)
                                            luxeCol.subgroups.slice(2).forEach((sub, rawSubIdx) => {
                                                const subIdx = rawSubIdx + 2; // adjust index based on slice
                                                sub.items.forEach((item, itemIdx) => {
                                                    const isFirstItemInSub = itemIdx === 0;
                                                    const highlight = isMatched(item.name, luxeCol.collection);

                                                    renderedRows.push(
                                                        <tr key={`luxe-p2-${subIdx}-${itemIdx}`} className={highlight ? 'pl-row-highlight' : ''}>
                                                            <td className="exact-color-cell">
                                                                <input
                                                                    type="text"
                                                                    value={item.name}
                                                                    onChange={(e) => handleCellChange(luxeColIdx, subIdx, itemIdx, 'name', e.target.value)}
                                                                    className="exact-input-cell text-left font-semibold"
                                                                />
                                                            </td>
                                                            {isFirstItemInSub && (
                                                                <td className="exact-price-cell text-center" rowSpan={sub.items.length}>
                                                                    <input
                                                                        type="text"
                                                                        value={sub.price3cm}
                                                                        onChange={(e) => handleCellChange(luxeColIdx, subIdx, null, 'price3cm', e.target.value)}
                                                                        className="exact-input-cell text-center font-bold"
                                                                    />
                                                                </td>
                                                            )}
                                                            {isFirstItemInSub && (
                                                                <td className="exact-price-cell text-center" rowSpan={sub.items.length}>
                                                                    <input
                                                                        type="text"
                                                                        value={sub.price2cm}
                                                                        onChange={(e) => handleCellChange(luxeColIdx, subIdx, null, 'price2cm', e.target.value)}
                                                                        className="exact-input-cell text-center font-bold"
                                                                    />
                                                                </td>
                                                            )}
                                                            <td className="exact-size-cell text-center">
                                                                <input
                                                                    type="text"
                                                                    value={item.size}
                                                                    onChange={(e) => handleCellChange(luxeColIdx, subIdx, itemIdx, 'size', e.target.value)}
                                                                    className="exact-input-cell text-center font-medium"
                                                                />
                                                            </td>
                                                            {!hasRenderedCollection && isFirstItemInSub && (
                                                                <td className="exact-collection-cell text-center font-bold" rowSpan={16}> {/* rowSpan 16 is for group 3 (4 items) + group 4 (8 items) + group 5 (4 items) */}
                                                                    <input
                                                                        type="text"
                                                                        value={luxeCol.collection}
                                                                        onChange={(e) => handleCollectionNameChange(luxeColIdx, e.target.value)}
                                                                        className="exact-input-cell text-center font-bold"
                                                                    />
                                                                </td>
                                                            )}
                                                        </tr>
                                                    );
                                                    if (isFirstItemInSub) hasRenderedCollection = true;
                                                });
                                            });
                                            return renderedRows;
                                        })()}

                                        {/* ThruTeQ Collection */}
                                        {(() => {
                                            const thruColIdx = sheetData.findIndex(c => c.collection === 'ThruTeQ');
                                            const thruCol = sheetData[thruColIdx];
                                            if (!thruCol) return null;
                                            const renderedRows = [];
                                            let hasRenderedCollection = false;

                                            thruCol.subgroups.forEach((sub, subIdx) => {
                                                sub.items.forEach((item, itemIdx) => {
                                                    const isFirstItemInSub = itemIdx === 0;
                                                    const highlight = isMatched(item.name, thruCol.collection);

                                                    renderedRows.push(
                                                        <tr key={`thru-${subIdx}-${itemIdx}`} className={highlight ? 'pl-row-highlight' : ''}>
                                                            <td className="exact-color-cell">
                                                                <input
                                                                    type="text"
                                                                    value={item.name}
                                                                    onChange={(e) => handleCellChange(thruColIdx, subIdx, itemIdx, 'name', e.target.value)}
                                                                    className="exact-input-cell text-left font-semibold"
                                                                />
                                                            </td>
                                                            {isFirstItemInSub && (
                                                                <td className="exact-price-cell text-center" rowSpan={sub.items.length}>
                                                                    <input
                                                                        type="text"
                                                                        value={sub.price3cm}
                                                                        onChange={(e) => handleCellChange(thruColIdx, subIdx, null, 'price3cm', e.target.value)}
                                                                        className="exact-input-cell text-center font-bold"
                                                                    />
                                                                </td>
                                                            )}
                                                            {isFirstItemInSub && (
                                                                <td className="exact-price-cell text-center" rowSpan={sub.items.length}>
                                                                    <input
                                                                        type="text"
                                                                        value={sub.price2cm}
                                                                        onChange={(e) => handleCellChange(thruColIdx, subIdx, null, 'price2cm', e.target.value)}
                                                                        className="exact-input-cell text-center font-bold"
                                                                    />
                                                                </td>
                                                            )}
                                                            <td className="exact-size-cell text-center">
                                                                <input
                                                                    type="text"
                                                                    value={item.size}
                                                                    onChange={(e) => handleCellChange(thruColIdx, subIdx, itemIdx, 'size', e.target.value)}
                                                                    className="exact-input-cell text-center font-medium"
                                                                />
                                                            </td>
                                                            {!hasRenderedCollection && isFirstItemInSub && (
                                                                <td className="exact-collection-cell text-center font-bold" rowSpan={getCollectionTotalRows(thruCol)}>
                                                                    <input
                                                                        type="text"
                                                                        value={thruCol.collection}
                                                                        onChange={(e) => handleCollectionNameChange(thruColIdx, e.target.value)}
                                                                        className="exact-input-cell text-center font-bold"
                                                                    />
                                                                </td>
                                                            )}
                                                        </tr>
                                                    );
                                                    if (isFirstItemInSub) hasRenderedCollection = true;
                                                });
                                            });
                                            return renderedRows;
                                        })()}
                                    </tbody>
                                </table>
                            </div>

                            {/* Footer disclaimer note block */}
                            <div className="pdf-page-footer-disclaimer">
                                <p>Prices are subject to change. We will review monthly and provide notification of any changes.</p>
                                <p>Please confirm slab sizes and availability prior to placing order and review Fabricator-Customer policies.</p>
                                <p>Contact your sales rep with questions. Estimate 60-90 day lead time for special order materials.</p>
                                <p className="font-bold text-center mt-1">Moda Quartz Price List is confidential.</p>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* ── FLAT INTERACTIVE CATALOG EDITABLE SEARCH VIEW ── */
                    <div className="pdf-flat-list-container no-print">
                        <div className="pdf-flat-table-wrapper">
                            <table className="pdf-flat-table">
                                <thead>
                                    <tr>
                                        <th>COLOR / MATERIAL NAME</th>
                                        <th style={{ textAlign: 'center' }}>3CM</th>
                                        <th style={{ textAlign: 'center' }}>2CM</th>
                                        <th style={{ textAlign: 'center' }}>SLAB SIZE</th>
                                        <th style={{ textAlign: 'center' }}>COLLECTION</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredFlatItems.map((item, idx) => (
                                        <tr key={idx}>
                                            <td className="font-bold text-left">
                                                <input
                                                    type="text"
                                                    value={item.name}
                                                    onChange={(e) => handleCellChange(item.colIdx, item.subIdx, item.itemIdx, 'name', e.target.value)}
                                                    className="exact-input-cell text-left font-bold"
                                                />
                                            </td>
                                            <td className="text-center font-semibold text-gold">
                                                <input
                                                    type="text"
                                                    value={item.price3cm}
                                                    onChange={(e) => handleCellChange(item.colIdx, item.subIdx, null, 'price3cm', e.target.value)}
                                                    className="exact-input-cell text-center font-bold text-gold"
                                                />
                                            </td>
                                            <td className="text-center">
                                                <input
                                                    type="text"
                                                    value={item.price2cm}
                                                    onChange={(e) => handleCellChange(item.colIdx, item.subIdx, null, 'price2cm', e.target.value)}
                                                    className="exact-input-cell text-center"
                                                />
                                            </td>
                                            <td className="text-center">
                                                <input
                                                    type="text"
                                                    value={item.size}
                                                    onChange={(e) => handleCellChange(item.colIdx, item.subIdx, item.itemIdx, 'size', e.target.value)}
                                                    className="exact-input-cell text-center"
                                                />
                                            </td>
                                            <td className="text-center">
                                                <input
                                                    type="text"
                                                    value={item.collection}
                                                    onChange={(e) => handleCollectionNameChange(item.colIdx, e.target.value)}
                                                    className={`exact-input-cell text-center pdf-collection-pill-input ${item.collection.toLowerCase()}`}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PriceListPanel;
