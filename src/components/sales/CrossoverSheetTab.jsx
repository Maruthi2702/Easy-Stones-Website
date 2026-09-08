import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  ArrowLeftRight, Search, Plus, Trash2, Edit3, RefreshCw,
  Download, Filter, Building2
} from 'lucide-react';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import CrossoverSheetModal from './CrossoverSheetModal';
import Pagination from '../shared/Pagination';
import CustomSelect from '../shared/CustomSelect';
import './CrossoverSheetTab.css';

const CrossoverSheetTab = ({ currentUser = null, sidebarToggle = null }) => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchTypeFilter, setMatchTypeFilter] = useState('All');

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  const userPermissions = currentUser?.permissions || [];
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'director' || !currentUser;
  const canAdd = isAdmin || userPermissions.includes('add_crossover_sheet');
  const canEdit = isAdmin || userPermissions.includes('edit_crossover_sheet');
  const canDelete = isAdmin || userPermissions.includes('delete_crossover_sheet');

  const fetchEntries = async () => {
    try {
      setLoading(true);
      const res = await authFetch(`${API_URL}/api/crossover-sheet`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setEntries(data);
      }
    } catch (err) {
      console.error('Failed to fetch crossover sheet:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, matchTypeFilter]);

  const handleSaveEntry = async (payload) => {
    try {
      setLoading(true);
      const isNew = !payload._id;
      const url = isNew ? `${API_URL}/api/crossover-sheet` : `${API_URL}/api/crossover-sheet/${payload._id}`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await authFetch(url, { method, body: JSON.stringify(payload) });

      if (res.ok) {
        setIsModalOpen(false);
        await fetchEntries();
      } else {
        const errData = await res.json();
        alert(errData.message || 'Failed to save crossover entry');
      }
    } catch (err) {
      console.error('Error saving crossover entry:', err);
      alert('Network error while saving crossover entry');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEntry = async (id, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Delete this crossover entry?')) return;

    try {
      const res = await authFetch(`${API_URL}/api/crossover-sheet/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setEntries(prev => prev.filter(item => item._id !== id));
      } else {
        alert('Failed to delete crossover entry');
      }
    } catch (err) {
      console.error('Error deleting crossover entry:', err);
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

  const filteredEntries = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return entries.filter(item => {
      const matchesSearch = !q ||
        (item.distributorName || '').toLowerCase().includes(q) ||
        (item.distributorColorName || '').toLowerCase().includes(q) ||
        (item.easyStonesName || '').toLowerCase().includes(q);
      const matchesType = matchTypeFilter === 'All' || item.matchType === matchTypeFilter;
      return matchesSearch && matchesType;
    });
  }, [entries, searchQuery, matchTypeFilter]);

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
      const list = filteredEntries.map(item => ({
        'Distributor Company': item.distributorName,
        'Distributor Color Name': item.distributorColorName,
        'Easy Stones Crossover': item.easyStonesName,
        'Match Type': item.matchType,
        'Notes': item.notes || ''
      }));
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

  const hasFilteredEverythingOut = filteredEntries.length === 0 && entries.length > 0;

  return (
    <div className="xover-tab-container">
      <div className="xover-header">
        <div className="xover-header-left">
          {sidebarToggle}
          <h2 className="xover-title-text">Crossover Sheet</h2>
        </div>

        <div className="xover-header-actions">
          <button type="button" className="xover-btn-export" onClick={handleExportExcel} title="Export to Excel">
            <Download size={15} />
            <span className="xover-btn-text-full">Export</span>
          </button>
          {canAdd && (
            <button type="button" className="xover-btn-add" onClick={handleOpenAddModal}>
              <Plus size={15} />
              <span className="xover-btn-text-full">Add Crossover</span>
              <span className="xover-btn-text-short">Add</span>
            </button>
          )}
        </div>
      </div>

      <p className="xover-subtitle">
        Distributor color names mapped to their closest Easy Stones equivalent, so a customer can order a match when their usual color isn't available.
      </p>

      <div className="xover-filter-bar">
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

      <div className="xover-grid-wrapper desktop-only">
        {loading ? (
          <div className="xover-loading">
            <RefreshCw size={24} className="xover-spin-icon" />
            <span>Loading Crossover Sheet...</span>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="xover-empty-state">
            <div className="xover-empty-icon-wrapper">
              {hasFilteredEverythingOut ? <Search size={30} /> : <ArrowLeftRight size={32} />}
            </div>
            {hasFilteredEverythingOut ? (
              <>
                <h4>No Matching Entries</h4>
                <p>{entries.length} entr{entries.length === 1 ? 'y' : 'ies'} on file, but none match the current search and filters.</p>
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
                        onClick={(e) => handleDeleteEntry(item._id, e)}
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
                  <button className="xover-mobile-action-btn delete" onClick={(e) => handleDeleteEntry(item._id, e)}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {filteredEntries.length > 0 && (
        <div className="xover-pagination-wrapper">
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
      />
    </div>
  );
};

export default CrossoverSheetTab;
