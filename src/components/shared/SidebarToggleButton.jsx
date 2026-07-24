import React from 'react';
import { Menu, PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import './SidebarToggleButton.css';

/**
 * Reusable Sidebar Toggle Button Component
 * Site-wide navigation menu toggle button supporting both Dark & Light themes.
 *
 * Props:
 *   isOpen    {boolean}  – Whether the sidebar is currently expanded
 *   onClick   {function} – Callback function to toggle sidebar open state
 *   title     {string}   – Accessible tooltip title
 *   className {string}   – Additional custom classes
 */
const SidebarToggleButton = ({
  isOpen = false,
  onClick,
  title = "Toggle navigation sidebar",
  className = ""
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`sidebar-toggle-btn ${isOpen ? 'is-open' : ''} ${className}`}
      title={title}
      aria-label={title}
    >
      <Menu size={20} className="sidebar-toggle-icon" />
    </button>
  );
};

export default SidebarToggleButton;
