import React, { useState } from 'react';
import { X, Palette, Plus, Trash2, Pencil, Check, AlertCircle } from 'lucide-react';

const ManageColorsModal = ({ isOpen, onClose, colors, onAdd, onRename, onDelete }) => {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    setNewName('');
    setEditingId(null);
    setError('');
    onClose();
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setError('');
    setBusy(true);
    try {
      const result = await onAdd(name);
      if (result?.success === false) {
        setError(result.message || 'Failed to add color');
      } else {
        setNewName('');
      }
    } finally {
      setBusy(false);
    }
  };

  const startEditing = (color) => {
    setEditingId(color._id);
    setEditingName(color.name);
    setError('');
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingName('');
  };

  const saveEditing = async (id) => {
    const name = editingName.trim();
    if (!name) return;
    setError('');
    setBusy(true);
    try {
      const result = await onRename(id, name);
      if (result?.success === false) {
        setError(result.message || 'Failed to rename color');
      } else {
        setEditingId(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = (color) => {
    if (!window.confirm(`Remove "${color.name}" from the color catalog? Existing crossover entries mapped to it are kept, but it will stop auto-seeding an empty row on the matrix.`)) return;
    onDelete(color._id);
  };

  return (
    <div className="xover-modal-overlay anim-fade-in" onClick={handleClose}>
      <div className="xover-modal-content anim-scale-in xover-manage-colors-content" onClick={(e) => e.stopPropagation()}>
        <div className="xover-modal-header">
          <div className="xover-modal-title-wrap">
            <div className="xover-modal-icon-badge">
              <Palette size={20} />
            </div>
            <div>
              <h3>Manage Easy Stones Colors</h3>
              <p className="xover-modal-sub-text">Add, rename, or remove colors from the catalog used to seed the matrix</p>
            </div>
          </div>
          <button type="button" className="xover-modal-close-btn" onClick={handleClose} title="Close">
            <X size={20} />
          </button>
        </div>

        <div className="xover-modal-form">
          {error && <div className="xover-modal-error-banner"><AlertCircle size={18} /> {error}</div>}

          <form onSubmit={handleAdd} className="xover-color-add-row">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New color name"
              className="xover-text-input"
              disabled={busy}
            />
            <button type="submit" className="xover-btn-save" disabled={busy || !newName.trim()}>
              <Plus size={16} />
              <span>Add</span>
            </button>
          </form>

          <div className="xover-color-list">
            {colors.length === 0 ? (
              <p className="xover-color-empty">No colors in the catalog yet.</p>
            ) : (
              colors.map(color => (
                <div key={color._id} className="xover-color-row">
                  {editingId === color._id ? (
                    <>
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="xover-text-input"
                        autoFocus
                        disabled={busy}
                      />
                      <button type="button" className="xover-color-icon-btn" onClick={() => saveEditing(color._id)} title="Save" disabled={busy}>
                        <Check size={15} />
                      </button>
                      <button type="button" className="xover-color-icon-btn" onClick={cancelEditing} title="Cancel" disabled={busy}>
                        <X size={15} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="xover-color-row-name">{color.name}</span>
                      <button type="button" className="xover-color-icon-btn" onClick={() => startEditing(color)} title="Rename">
                        <Pencil size={14} />
                      </button>
                      <button type="button" className="xover-color-icon-btn delete" onClick={() => handleDelete(color)} title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="xover-modal-footer">
          <button type="button" className="xover-btn-cancel" onClick={handleClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default ManageColorsModal;
