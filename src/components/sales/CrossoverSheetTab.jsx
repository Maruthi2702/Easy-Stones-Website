import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  ArrowLeftRight, Search, Plus, Trash2, Edit3, RefreshCw,
  Download, Filter, Building2, LayoutGrid, List, Printer, Palette
} from 'lucide-react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import CrossoverSheetModal from './CrossoverSheetModal';
import ManageColorsModal from './ManageColorsModal';
import Pagination from '../shared/Pagination';
import CustomSelect from '../shared/CustomSelect';
import { flattenColorDocs, buildMatrixData, removeCrossoverLocally, upsertColorDoc } from './crossoverSheetHelpers';
import './CrossoverSheetTab.css';

// Kept outside the component so switching tabs away and back (which fully
// unmounts this component) can repaint instantly from the last fetch
// instead of showing a spinner every time, then quietly re-fetching.
let cachedEntries = null;
// Same idea for the color catalog, which used to be a hardcoded array
// (src/data/easyStonesColors.js) and now lives in the EasyStonesColor
// collection so admins can add/rename/remove colors without a deploy.
let cachedColors = null;

const CrossoverSheetTab = ({ currentUser = null, sidebarToggle = null }) => {
  // One document per Easy Stones color, each holding an embedded array of
  // that color's distributor mappings (src/models/CrossoverSheet.js).
  const [colorDocs, setColorDocs] = useState(cachedEntries || []);
  const [loading, setLoading] = useState(cachedEntries === null);
  const [colors, setColors] = useState(cachedColors || []);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchTypeFilter, setMatchTypeFilter] = useState('All');
  const [viewMode, setViewMode] = useState('matrix');

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [isManageColorsOpen, setIsManageColorsOpen] = useState(false);

  const colorNames = useMemo(() => colors.map(c => c.name), [colors]);

  const userPermissions = currentUser?.permissions || [];
  // Fails closed on a missing currentUser (no admin capabilities), not
  // open. SalesPage's only render of this component already gates on
  // `!authLoading && currentUser?.permissions`, so currentUser is always a
  // real, loaded user by the time this mounts today — but a component
  // should never treat "user unknown" as "grant full admin," since that's
  // exactly the state a future caller (a different embed, a test harness)
  // could hit by accident.
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'director';
  const canAdd = isAdmin || userPermissions.includes('add_crossover_sheet');
  const canEdit = isAdmin || userPermissions.includes('edit_crossover_sheet');
  const canDelete = isAdmin || userPermissions.includes('delete_crossover_sheet');
  const canManageColors = isAdmin || userPermissions.includes('manage_easy_stones_colors');

  const fetchEntries = async ({ background = false } = {}) => {
    try {
      if (!background) setLoading(true);
      const res = await authFetch(`${API_URL}/api/crossover-sheet`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          cachedEntries = data;
          setColorDocs(data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch crossover sheet:', err);
    } finally {
      if (!background) setLoading(false);
    }
  };

  // Flattened to one row per distributor mapping (carrying the parent
  // color document's _id as colorId) for the search/filter/pagination/edit
  // logic below, which all operate at the single-mapping level. See
  // crossoverSheetHelpers.js / its test file for the pure grouping logic.
  const flatEntries = useMemo(() => flattenColorDocs(colorDocs), [colorDocs]);

  const fetchColors = async () => {
    try {
      const res = await authFetch(`${API_URL}/api/easy-stones-colors`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          cachedColors = data;
          setColors(data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch Easy Stones colors:', err);
    }
  };

  useEffect(() => {
    // If we already have a cached copy from a previous visit this session,
    // show it immediately and just refresh it quietly in the background.
    fetchEntries({ background: cachedEntries !== null });
    fetchColors();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, matchTypeFilter]);

  // Patches colorDocs from the mutation's own response instead of
  // refetching the whole crossover sheet after every single save — the
  // response already carries everything needed (see crossoverSheetHelpers.js).
  const applyColorDocUpdate = (colorDoc) => {
    setColorDocs(prev => {
      const next = upsertColorDoc(prev, colorDoc);
      cachedEntries = next;
      return next;
    });
  };

  const handleSaveEntry = async (payload) => {
    try {
      const isNew = !payload._id;
      const url = isNew
        ? `${API_URL}/api/crossover-sheet`
        : `${API_URL}/api/crossover-sheet/${payload.colorId}/${payload._id}`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await authFetch(url, { method, body: JSON.stringify(payload) });

      if (res.ok) {
        const data = await res.json();
        setIsModalOpen(false);
        if (isNew) {
          // POST responds with the (possibly newly created) color doc directly.
          applyColorDocUpdate(data);
        } else if (data.moved) {
          // Editing moved the mapping to a different Easy Stones color's
          // document — drop it from the old one (or the whole doc, if that
          // was its last mapping) before applying the destination doc.
          setColorDocs(prev => {
            const next = removeCrossoverLocally(prev, data.sourceColorId, payload._id);
            cachedEntries = next;
            return next;
          });
          applyColorDocUpdate(data.colorDoc);
        } else {
          applyColorDocUpdate(data.colorDoc);
        }
      } else {
        const errData = await res.json();
        alert(errData.message || 'Failed to save crossover entry');
      }
    } catch (err) {
      console.error('Error saving crossover entry:', err);
      alert('Network error while saving crossover entry');
    }
  };

  const handleDeleteEntry = async (item, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Delete this crossover entry?')) return;

    try {
      const res = await authFetch(`${API_URL}/api/crossover-sheet/${item.colorId}/${item._id}`, { method: 'DELETE' });
      if (res.ok) {
        setColorDocs(prev => {
          const next = removeCrossoverLocally(prev, item.colorId, item._id);
          cachedEntries = next;
          return next;
        });
      } else {
        alert('Failed to delete crossover entry');
      }
    } catch (err) {
      console.error('Error deleting crossover entry:', err);
    }
  };

  const handleAddColor = async (name) => {
    try {
      const res = await authFetch(`${API_URL}/api/easy-stones-colors`, { method: 'POST', body: JSON.stringify({ name }) });
      if (res.ok) {
        const data = await res.json();
        setColors(prev => {
          const next = [...prev, data].sort((a, b) => a.order - b.order);
          cachedColors = next;
          return next;
        });
        return { success: true };
      }
      const errData = await res.json();
      return { success: false, message: errData.message };
    } catch (err) {
      console.error('Error adding color:', err);
      return { success: false, message: 'Network error while adding color' };
    }
  };

  const handleRenameColor = async (id, name) => {
    try {
      const res = await authFetch(`${API_URL}/api/easy-stones-colors/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
      if (res.ok) {
        const data = await res.json();
        setColors(prev => {
          const next = prev.map(c => c._id === id ? data : c);
          cachedColors = next;
          return next;
        });
        return { success: true };
      }
      const errData = await res.json();
      return { success: false, message: errData.message };
    } catch (err) {
      console.error('Error renaming color:', err);
      return { success: false, message: 'Network error while renaming color' };
    }
  };

  const handleDeleteColor = async (id) => {
    try {
      const res = await authFetch(`${API_URL}/api/easy-stones-colors/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setColors(prev => {
          const next = prev.filter(c => c._id !== id);
          cachedColors = next;
          return next;
        });
      } else {
        alert('Failed to delete color');
      }
    } catch (err) {
      console.error('Error deleting color:', err);
    }
  };

  const handleOpenAddModal = () => {
    setEditingItem(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (item, e) => {
    if (e) e.stopPropagation();
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleOpenAddModalFor = (easyStonesName, distributorName) => {
    setEditingItem({ easyStonesName, distributorName });
    setIsModalOpen(true);
  };

  const filteredEntries = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return flatEntries.filter(item => {
      const matchesSearch = !q ||
        (item.distributorName || '').toLowerCase().includes(q) ||
        (item.distributorColorName || '').toLowerCase().includes(q) ||
        (item.easyStonesName || '').toLowerCase().includes(q);
      const matchesType = matchTypeFilter === 'All' || item.matchType === matchTypeFilter;
      return matchesSearch && matchesType;
    });
  }, [flatEntries, searchQuery, matchTypeFilter]);

  const matrixData = useMemo(
    () => buildMatrixData(filteredEntries, colorNames, { matchTypeFilter, searchQuery }),
    [filteredEntries, matchTypeFilter, searchQuery, colorNames]
  );

  const catalogCoverage = useMemo(() => {
    const mappedSet = new Set(colorDocs.map(d => d.easyStonesName));
    const mapped = colorNames.filter(name => mappedSet.has(name)).length;
    return { mapped, total: colorNames.length };
  }, [colorDocs, colorNames]);

  const existingDistributors = useMemo(() => {
    return Array.from(new Set(flatEntries.map(e => e.distributorName).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [flatEntries]);

  const totalPages = Math.ceil(filteredEntries.length / rowsPerPage) || 1;
  const paginatedEntries = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return filteredEntries.slice(start, start + rowsPerPage);
  }, [filteredEntries, currentPage, rowsPerPage]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setMatchTypeFilter('All');
  };

  const handleExportExcel = () => {
    try {
      const list = matrixData.rows.map(row => {
        const rowData = { 'Easy Stones': row.easyStonesName };
        matrixData.distributors.forEach(distributor => {
          const cellEntries = row.cells.get(distributor) || [];
          rowData[distributor] = cellEntries
            .map(entry => `${entry.distributorColorName} (${entry.matchType})${entry.notes ? ' - ' + entry.notes : ''}`)
            .join('; ');
        });
        return rowData;
      });
      const worksheet = XLSX.utils.json_to_sheet(list);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Crossover Sheet');
      const dateStr = new Date().toISOString().split('T')[0];
      XLSX.writeFile(workbook, `EasyStones_Crossover_Sheet_${dateStr}.xlsx`);
    } catch (error) {
      console.error('Error exporting crossover sheet to Excel:', error);
      alert('Failed to export data to Excel file');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const hasFilteredEverythingOut = filteredEntries.length === 0 && flatEntries.length > 0;

  return (
    <div className="xover-tab-container">
      <div className="xover-header">
        <div className="xover-header-left">
          {sidebarToggle}
          <h2 className="xover-title-text">Crossover Sheet</h2>
        </div>

        <div className="xover-header-actions no-print">
          <div className="xover-view-toggle">
            <button
              type="button"
              className={`xover-view-btn ${viewMode === 'matrix' ? 'active' : ''}`}
              onClick={() => setViewMode('matrix')}
              title="Matrix View"
            >
              <LayoutGrid size={15} />
              <span className="xover-btn-text-full">Matrix</span>
            </button>
            <button
              type="button"
              className={`xover-view-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List View"
            >
              <List size={15} />
              <span className="xover-btn-text-full">List</span>
            </button>
          </div>
          <button type="button" className="xover-btn-export" onClick={handlePrint} title="Print / Save as PDF">
            <Printer size={15} />
            <span className="xover-btn-text-full">PDF</span>
          </button>
          <button type="button" className="xover-btn-export" onClick={handleExportExcel} title="Export to Excel">
            <Download size={15} />
            <span className="xover-btn-text-full">Export</span>
          </button>
          {canManageColors && (
            <button type="button" className="xover-btn-export" onClick={() => setIsManageColorsOpen(true)} title="Manage Easy Stones Colors">
              <Palette size={15} />
              <span className="xover-btn-text-full">Colors</span>
            </button>
          )}
          {canAdd && (
            <button type="button" className="xover-btn-add" onClick={handleOpenAddModal}>
              <Plus size={15} />
              <span className="xover-btn-text-full">Add Crossover</span>
              <span className="xover-btn-text-short">Add</span>
            </button>
          )}
        </div>
      </div>

      <p className="xover-subtitle no-print">
        Distributor color names mapped to their closest Easy Stones equivalent, so a customer can order a match when their usual color isn't available.
        {viewMode === 'matrix' && (
          <span className="xover-coverage-stat">
            {catalogCoverage.mapped} / {catalogCoverage.total} colors have a crossover mapped
          </span>
        )}
      </p>

      {/* Print/PDF-only header — swaps the on-screen title+explainer for the
          company logo and a compact coverage stat, since the explainer text
          is redundant on a printed reference sheet. */}
      <div className="xover-print-header">
        <img src="/logo.png" alt="Easy Stones" className="xover-print-logo" />
        <div className="xover-print-header-text">
          <h2>Crossover Sheet</h2>
          {viewMode === 'matrix' && (
            <span>{catalogCoverage.mapped} / {catalogCoverage.total} colors have a crossover mapped</span>
          )}
        </div>
      </div>

      <div className="xover-filter-bar no-print">
        <div className="xover-search-box">
          <Search size={16} className="xover-search-icon" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search distributor, color, or crossover name..."
          />
          {searchQuery && (
            <button className="xover-clear-search-btn" onClick={() => setSearchQuery('')}>×</button>
          )}
        </div>

        <div className="xover-select-filter-wrap">
          <Filter size={14} className="xover-filter-icon" />
          <CustomSelect
            value={matchTypeFilter}
            onChange={(e) => setMatchTypeFilter(e.target.value)}
            options={[
              { value: 'All', label: 'All Match Types' },
              { value: 'Direct Crossover', label: 'Direct Crossover' },
              { value: 'Similar', label: 'Similar' }
            ]}
          />
        </div>
      </div>

      <div className={`xover-grid-wrapper desktop-only ${viewMode === 'matrix' ? 'is-matrix' : ''}`}>
        {loading ? (
          <div className="xover-loading">
            <RefreshCw size={24} className="xover-spin-icon" />
            <span>Loading Crossover Sheet...</span>
          </div>
        ) : (viewMode === 'matrix' ? matrixData.rows.length === 0 : filteredEntries.length === 0) ? (
          <div className="xover-empty-state">
            <div className="xover-empty-icon-wrapper">
              {hasFilteredEverythingOut ? <Search size={30} /> : <ArrowLeftRight size={32} />}
            </div>
            {hasFilteredEverythingOut ? (
              <>
                <h4>No Matching Entries</h4>
                <p>{flatEntries.length} entr{flatEntries.length === 1 ? 'y' : 'ies'} on file, but none match the current search and filters.</p>
                <button className="xover-btn-clear-filters" onClick={handleResetFilters}>Clear Filters</button>
              </>
            ) : (
              <>
                <h4>No Crossover Entries Yet</h4>
                <p>Add a distributor's color name and its Easy Stones equivalent so staff can quote a match on the spot.</p>
                {canAdd && (
                  <button className="xover-btn-add-empty" onClick={handleOpenAddModal}>
                    <Plus size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Add Crossover
                  </button>
                )}
              </>
            )}
          </div>
        ) : viewMode === 'matrix' ? (
          <table className="xover-matrix-table">
            <thead>
              <tr>
                <th className="matrix-corner">Easy Stones</th>
                {matrixData.distributors.map(distributor => (
                  <th key={distributor} className="matrix-col-header" title={distributor}>{distributor}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrixData.rows.map(row => (
                <tr key={row.easyStonesName} className="matrix-row">
                  <td className="matrix-row-header" title={row.easyStonesName}>
                    <span className="xover-crossover-name">{row.easyStonesName}</span>
                  </td>
                  {matrixData.distributors.map(distributor => {
                    const cellEntries = row.cells.get(distributor) || [];
                    return (
                      <td key={distributor} className="matrix-cell">
                        {cellEntries.length > 0 ? (
                          cellEntries.map(entry => (
                            <div key={entry._id} className="matrix-chip-wrap">
                              <button
                                type="button"
                                className="matrix-chip"
                                onClick={(e) => canEdit && handleOpenEditModal(entry, e)}
                                title={entry.notes || `${entry.distributorColorName} — ${entry.matchType}`}
                                disabled={!canEdit}
                              >
                                <span className="matrix-chip-color">{entry.distributorColorName}</span>
                                <span className={`xover-match-badge sm ${entry.matchType === 'Direct Crossover' ? 'direct' : 'similar'}`}>
                                  {entry.matchType === 'Direct Crossover' ? 'Direct' : 'Similar'}
                                </span>
                              </button>
                              {canDelete && (
                                <button
                                  type="button"
                                  className="matrix-chip-delete"
                                  onClick={(e) => handleDeleteEntry(entry, e)}
                                  title="Delete Entry"
                                >
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </div>
                          ))
                        ) : canAdd ? (
                          <button
                            type="button"
                            className="matrix-add-btn"
                            onClick={() => handleOpenAddModalFor(row.easyStonesName, distributor)}
                            title={`Add ${distributor} crossover for ${row.easyStonesName}`}
                          >
                            <Plus size={12} />
                          </button>
                        ) : (
                          <span className="matrix-empty-dash">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="xover-table">
            <thead>
              <tr>
                <th className="h-distributor"><Building2 size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />Distributor</th>
                <th className="h-color">Distributor Color</th>
                <th className="h-easystones">Easy Stones Crossover</th>
                <th className="h-match">Match</th>
                <th className="h-notes">Notes</th>
                <th className="h-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedEntries.map(item => (
                <tr key={item._id} className="xover-row">
                  <td className="col-distributor" title={item.distributorName}>{item.distributorName}</td>
                  <td className="col-color" title={item.distributorColorName}>{item.distributorColorName}</td>
                  <td className="col-easystones" title={item.easyStonesName}>
                    <span className="xover-crossover-name">{item.easyStonesName}</span>
                  </td>
                  <td className="col-match">
                    <span className={`xover-match-badge ${item.matchType === 'Direct Crossover' ? 'direct' : 'similar'}`}>
                      {item.matchType}
                    </span>
                  </td>
                  <td className="col-notes" title={item.notes || ''}>{item.notes || '—'}</td>
                  <td className="col-actions">
                    {canEdit && (
                      <button
                        type="button"
                        className="xover-action-btn edit-btn"
                        onClick={(e) => handleOpenEditModal(item, e)}
                        title="Edit Entry"
                      >
                        <Edit3 size={16} />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        className="xover-action-btn delete-btn"
                        onClick={(e) => handleDeleteEntry(item, e)}
                        title="Delete Entry"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="xover-mobile-cards mobile-only">
        {filteredEntries.length === 0 ? (
          <div className="xover-empty-state">
            <div className="xover-empty-icon-wrapper">
              {hasFilteredEverythingOut ? <Search size={28} /> : <ArrowLeftRight size={28} />}
            </div>
            {hasFilteredEverythingOut ? (
              <>
                <h4>No Matching Entries</h4>
                <p>Nothing on file matches the current search and filters.</p>
                <button className="xover-btn-clear-filters" onClick={handleResetFilters}>Clear Filters</button>
              </>
            ) : (
              <>
                <h4>No Crossover Entries Yet</h4>
                <p>Add a distributor color to start building the crossover reference.</p>
              </>
            )}
          </div>
        ) : (
          paginatedEntries.map(item => (
            <div key={item._id} className="xover-card-mobile">
              <div className="xover-card-top-row">
                <span className="xover-card-distributor">{item.distributorName}</span>
                <span className={`xover-match-badge ${item.matchType === 'Direct Crossover' ? 'direct' : 'similar'}`}>
                  {item.matchType}
                </span>
              </div>
              <div className="xover-card-mapping">
                <span className="xover-card-color">{item.distributorColorName}</span>
                <ArrowLeftRight size={14} className="xover-card-arrow" />
                <span className="xover-card-crossover">{item.easyStonesName}</span>
              </div>
              {item.notes && <p className="xover-card-notes">"{item.notes}"</p>}
              <div className="xover-card-actions">
                {canEdit && (
                  <button className="xover-mobile-action-btn" onClick={(e) => handleOpenEditModal(item, e)}>
                    <Edit3 size={15} /> Edit
                  </button>
                )}
                {canDelete && (
                  <button className="xover-mobile-action-btn delete" onClick={(e) => handleDeleteEntry(item, e)}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {filteredEntries.length > 0 && (
        <div className={`xover-pagination-wrapper no-print ${viewMode === 'matrix' ? 'hide-on-desktop' : ''}`}>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={(page) => setCurrentPage(page)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(limit) => {
              setRowsPerPage(limit);
              setCurrentPage(1);
            }}
            rowsPerPageOptions={[10, 20, 50, 100]}
          />
        </div>
      )}

      <CrossoverSheetModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveEntry}
        initialData={editingItem}
        existingDistributors={existingDistributors}
        easyStonesColorOptions={colorNames}
      />

      <ManageColorsModal
        isOpen={isManageColorsOpen}
        onClose={() => setIsManageColorsOpen(false)}
        colors={colors}
        onAdd={handleAddColor}
        onRename={handleRenameColor}
        onDelete={handleDeleteColor}
      />
    </div>
  );
};

export default CrossoverSheetTab;
