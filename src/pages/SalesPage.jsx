import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Calendar, MapPin, Phone, Mail, Clock, Plus, Search,
    Filter, X, Upload, Home, ArrowLeft,
    CheckCircle, MessageSquare, Heart, ThumbsUp, Send, User, Menu,
    Edit, Trash2, Download, Share2, Pin, PinOff, ChevronLeft, ChevronRight,
    Info, DollarSign, ShieldCheck, FileText, Eye, Paperclip, Loader,
    CreditCard, Edit2, Hash, Smile, UserPlus, FolderPlus, Folder, Link,
    LayoutDashboard, Pencil
} from 'lucide-react';
import * as XLSX from 'xlsx';

import { API_URL } from '../config/api';
import { useAuth } from '../context/AuthContext';
import './SalesPage.css';
import './SalesPageChat.css';
import './SalesPageChatImage.css';
import './SalesPageDashboard.css';
import SearchableSelect from '../components/SearchableSelect';
import SalesPlannerTab from '../components/SalesPlannerTab';
import CustomDatePicker from '../components/CustomDatePicker';
import { formatForDateInput } from '../utils/dateUtils';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        this.setState({ error, errorInfo });
        console.error("SalesPage Error:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: '2rem', color: 'red' }}>
                    <h2>Something went wrong.</h2>
                    <details style={{ whiteSpace: 'pre-wrap' }}>
                        {this.state.error && this.state.error.toString()}
                        <br />
                        {this.state.errorInfo && this.state.errorInfo.componentStack}
                    </details>
                </div>
            );
        }

        return this.props.children;
    }
}

const SalesPage = () => {
    const { user: currentUser } = useAuth();
    const navigate = useNavigate();
    const [customers, setCustomers] = useState([]);
    const [selectedCustomerId, setSelectedCustomerId] = useState(null);
    const [selectedCustomerDetail, setSelectedCustomerDetail] = useState(null); // Full customer details with images
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState('visits');

    // Dashboard State (Required for memoized values)
    const [dashboardTimeRange, setDashboardTimeRange] = useState('1day');
    const [dashboardSearchTerm, setDashboardSearchTerm] = useState('');
    const [activeDashboardTab, setActiveDashboardTab] = useState('visits'); // 'visits' or 'resources'
    const [todayScheduleCount, setTodayScheduleCount] = useState(0);
    const [activeResourceSubTab, setActiveResourceSubTab] = useState('client'); // 'client' or 'team'
    const [currentUserId, setCurrentUserId] = useState(currentUser?.id || currentUser?._id || null);

    // Sync currentUserId when currentUser changes
    useEffect(() => {
        if (currentUser) {
            setCurrentUserId(currentUser.id || currentUser._id);
        }
    }, [currentUser]);

    // Fetch today's schedule count
    useEffect(() => {
        const fetchTodaySchedule = async () => {
            try {
                const today = new Date();
                const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
                const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();
                const response = await fetch(`${API_URL}/api/schedule?start=${startOfDay}&end=${endOfDay}`, {
                    credentials: 'include'
                });
                if (response.ok) {
                    const data = await response.json();
                    setTodayScheduleCount(data.length);
                }
            } catch (error) {
                console.error('Error fetching today schedule:', error);
            }
        };
        fetchTodaySchedule();
    }, []);

    // Modal states
    const [showContactModal, setShowContactModal] = useState(false);
    const [showVisitModal, setShowVisitModal] = useState(false);
    const [showResourceModal, setShowResourceModal] = useState(false);
    const [editingContact, setEditingContact] = useState(null);
    const [editingVisit, setEditingVisit] = useState(null);
    const [editingResource, setEditingResource] = useState(null);

    const [showAddFolderModal, setShowAddFolderModal] = useState(false);
    const [folderName, setFolderName] = useState('');

    const customerOptions = React.useMemo(() => {
        return customers
            .sort((a, b) => (a.company || a.contactName || '').localeCompare(b.company || b.contactName || ''))
            .map(c => ({
                value: c._id,
                label: c.company || c.contactName || 'Unknown'
            }));
    }, [customers]);

    const allVisits = React.useMemo(() => {
        if (!customers || !Array.isArray(customers)) return [];
        return customers.flatMap(c => {
            if (!c) return [];
            const customerName = c.company || c.contactName || `${c.firstName || ''} ${c.lastName || ''}`.trim();
            return (c.visits || []).filter(v => v !== null).map(v => ({
                ...v,
                customerName,
                customerId: c._id
            }));
        });
    }, [customers]);

    const allResources = React.useMemo(() => {
        if (!customers || !Array.isArray(customers)) return [];
        return customers.flatMap(c => {
            if (!c) return [];
            const customerName = c.company || c.contactName || `${c.firstName || ''} ${c.lastName || ''}`.trim();
            return (c.resources || []).filter(r => r !== null).map(r => ({
                ...r,
                customerName,
                customerId: c._id
            }));
        });
    }, [customers]);

    const dashboardDateRangeStart = React.useMemo(() => {
        const now = new Date();
        const localDateStr = formatForDateInput(new Date());
        let start;
        switch (dashboardTimeRange) {
            case '1day':
                start = new Date(`${localDateStr}T00:00:00.000Z`);
                break;
            case '7days':
                start = new Date();
                start.setDate(now.getDate() - 7);
                const sevenDaysAgoStr = formatForDateInput(start);
                start = new Date(`${sevenDaysAgoStr}T00:00:00.000Z`);
                break;
            case '30days':
                start = new Date();
                start.setDate(now.getDate() - 30);
                const thirtyDaysAgoStr = formatForDateInput(start);
                start = new Date(`${thirtyDaysAgoStr}T00:00:00.000Z`);
                break;
            case 'year':
                start = new Date(now.getFullYear(), 0, 1);
                const yearStartStr = formatForDateInput(start);
                start = new Date(`${yearStartStr}T00:00:00.000Z`);
                break;
            case 'all':
                return null;
            default:
                start = new Date(`${localDateStr}T00:00:00.000Z`);
        }
        return start;
    }, [dashboardTimeRange]);

    const dashboardStats = React.useMemo(() => {
        const stats = { visits: 0, keyVisits: 0, bids: 0, followUp: 0, resources: 0, quickNotes: 0 };
        const startDate = dashboardDateRangeStart;
        const currentUserIdStr = currentUserId?.toString();

        // Single pass for visits
        allVisits.forEach(v => {
            if (!v) return;
            const visitDate = new Date(v.date || v.createdAt);
            const dateMatch = !startDate || visitDate >= startDate;
            const userMatch = (currentUser?.role === 'admin' || currentUser?.role === 'director' || currentUser?.role === 'manager') || v.createdBy === currentUserIdStr;

            if (dateMatch && userMatch) {
                const isQuickNote = v.purpose?.toLowerCase().includes('quick note');
                if (isQuickNote) {
                    stats.quickNotes++;
                } else {
                    stats.visits++;
                    const outcome = (v.outcome || '').toLowerCase();
                    const notes = (v.notes || '').toLowerCase();

                    if (outcome.includes('order') || outcome.includes('sale') || outcome.includes('sold') || outcome.includes('deposit') ||
                        notes.includes('order') || notes.includes('sale') || notes.includes('sold')) {
                        stats.keyVisits++;
                    }

                    if (outcome.includes('bid') || outcome.includes('quote') || notes.includes('bid') || notes.includes('quote')) {
                        stats.bids++;
                    }

                    if (v.nextAction) {
                        stats.followUp++;
                    }
                }
            }
        });

        // Single pass for resources
        allResources.forEach(r => {
            if (!r) return;
            const resourceDate = new Date(r.date || r.createdAt);
            const dateMatch = !startDate || resourceDate >= startDate;
            const userMatch = (currentUser?.role === 'admin' || currentUser?.role === 'director' || currentUser?.role === 'manager') || (r.uploadedBy || r.createdBy) === currentUserIdStr;
            if (dateMatch && userMatch) {
                stats.resources++;
            }
        });

        return stats;
    }, [allVisits, allResources, dashboardDateRangeStart, currentUser, currentUserId]);

    const memoizedFilteredVisits = React.useMemo(() => {
        const startDate = dashboardDateRangeStart;
        const searchLower = dashboardSearchTerm.toLowerCase();
        const currentUserIdStr = currentUserId?.toString();

        return allVisits.filter(v => {
            if (!v) return false;
            const visitDate = new Date(v.date || v.createdAt);
            const dateMatch = !startDate || visitDate >= startDate;
            const userMatch = (currentUser?.role === 'admin' || currentUser?.role === 'director' || currentUser?.role === 'manager') || v.createdBy === currentUserIdStr;
            const searchMatch = !dashboardSearchTerm ||
                (v.customerName?.toLowerCase().includes(searchLower)) ||
                (v.notes?.toLowerCase().includes(searchLower)) ||
                (v.purpose?.toLowerCase().includes(searchLower));

            const isQuickNote = v.purpose?.toLowerCase().includes('quick note');
            const quickNoteExclude = activeDashboardTab === 'visits' ? !isQuickNote : true;

            return dateMatch && userMatch && searchMatch && quickNoteExclude;
        }).sort((a, b) => new Date(b?.date || b?.createdAt || 0) - new Date(a?.date || a?.createdAt || 0));
    }, [allVisits, dashboardDateRangeStart, currentUser, currentUserId, dashboardSearchTerm, activeDashboardTab]);

    const memoizedFilteredResources = React.useMemo(() => {
        const startDate = dashboardDateRangeStart;
        const searchLower = dashboardSearchTerm.toLowerCase();
        const currentUserIdStr = currentUserId?.toString();

        return allResources.filter(r => {
            if (!r) return false;
            const resourceDate = new Date(r.date || r.createdAt);
            const dateMatch = !startDate || resourceDate >= startDate;
            const userMatch = (currentUser?.role === 'admin' || currentUser?.role === 'director' || currentUser?.role === 'manager') || (r.uploadedBy || r.createdBy) === currentUserIdStr;
            const searchMatch = !dashboardSearchTerm ||
                (r.customerName?.toLowerCase().includes(searchLower)) ||
                (r.description?.toLowerCase().includes(searchLower)) ||
                (r.resourceType?.toLowerCase().includes(searchLower)) ||
                (r.notes?.toLowerCase().includes(searchLower));

            return dateMatch && userMatch && searchMatch;
        }).sort((a, b) => new Date(b?.date || b?.createdAt || 0) - new Date(a?.date || a?.createdAt || 0));
    }, [allResources, dashboardDateRangeStart, currentUser, currentUserId, dashboardSearchTerm]);
    const [isViewingResource, setIsViewingResource] = useState(false);
    const [isViewingVisit, setIsViewingVisit] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showCustomerInfo, setShowCustomerInfo] = useState(false);
    const [isChatFullScreen, setIsChatFullScreen] = useState(false);
    const [quickNote, setQuickNote] = useState('');
    const [isSavingNote, setIsSavingNote] = useState(false);


    // Sidebar State
    const [isPinned, setIsPinned] = useState(() => {
        const saved = localStorage.getItem('sidebarPinned');
        return saved !== null ? JSON.parse(saved) : true;
    });
    const [sidebarWidth, setSidebarWidth] = useState(() => {
        const saved = localStorage.getItem('sidebarWidth');
        return saved ? parseInt(saved, 10) : 300;
    });
    const [isResizing, setIsResizing] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth <= 768);
            if (window.innerWidth > 768) {
                setIsSidebarOpen(true);
            }
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const startResizing = useCallback(() => {
        setIsResizing(true);
    }, []);

    const stopResizing = useCallback(() => {
        setIsResizing(false);
    }, []);

    const resize = useCallback(
        (mouseMoveEvent) => {
            if (isResizing) {
                const newWidth = mouseMoveEvent.clientX;
                if (newWidth >= 220 && newWidth <= 600) {
                    setSidebarWidth(newWidth);
                }
            }
        },
        [isResizing]
    );

    useEffect(() => {
        window.addEventListener("mousemove", resize);
        window.addEventListener("mouseup", stopResizing);
        return () => {
            window.removeEventListener("mousemove", resize);
            window.removeEventListener("mouseup", stopResizing);
        };
    }, [resize, stopResizing]);

    useEffect(() => {
        localStorage.setItem('sidebarWidth', sidebarWidth);
    }, [sidebarWidth]);

    useEffect(() => {
        localStorage.setItem('sidebarPinned', JSON.stringify(isPinned));
        if (isPinned && !isMobile) {
            setIsSidebarOpen(true);
        } else {
            // Collapse immediately when unpinning
            setIsSidebarOpen(false);
        }
    }, [isPinned]);

    const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
    const togglePin = () => setIsPinned(!isPinned);

    // Form states
    const [contactForm, setContactForm] = useState({
        name: '',
        phone: '',
        email: '',
        role: '',
        isPrimary: false,
        notes: ''
    });

    const [visitForm, setVisitForm] = useState({
        date: '',
        purpose: 'Scheduled in Person Sales Meeting',
        notes: '',
        outcome: '',
        nextAction: '',
        image: [] // Array of strings
    });

    const [resourceForm, setResourceForm] = useState({
        title: '',
        date: formatForDateInput(new Date()),
        customerId: '', // Added to track actual customer ID
        customer: '',
        location: '',
        resourceType: '',
        image: [], // Array of strings
        description: '',
        notes: '',
        status: 'Active',
        url: '',
        uploadedBy: ''
    });

    // Resources tab state


    const [expandedResourceId, setExpandedResourceId] = useState(null);
    const [imagePreview, setImagePreview] = useState(null);
    const [fullScreenImage, setFullScreenImage] = useState(null);
    const [fullScreenGallery, setFullScreenGallery] = useState([]);
    const [fullScreenIndex, setFullScreenIndex] = useState(0);
    const [activeReactionMessageId, setActiveReactionMessageId] = useState(null);
    const [visitsLoading, setVisitsLoading] = useState(false);

    // Sales Dashboard State
    const [salesResources, setSalesResources] = useState([]);
    console.log('SalesPage Render: salesResources', salesResources);
    const [showDashboard, setShowDashboard] = useState(true);
    const [showDashboardUploadModal, setShowDashboardUploadModal] = useState(false);
    const [loadingVisitId, setLoadingVisitId] = useState(null);
    const [loadingResourceId, setLoadingResourceId] = useState(null);

    // Custom Delete Confirmation Modal
    const [deleteConfirmation, setDeleteConfirmation] = useState({
        isOpen: false,
        type: '', // 'contact', 'visit', 'resource'
        id: null,
        customerId: null,
        message: ''
    });
    const [dashboardUploadForm, setDashboardUploadForm] = useState({
        name: '',
        type: 'file',
        content: '',
        file: null
    });
    const [editingDashboardResource, setEditingDashboardResource] = useState(null);
    const [previewDashboardResource, setPreviewDashboardResource] = useState(null);
    const [isExistingFileRemoved, setIsExistingFileRemoved] = useState(false);
    const [currentFolderId, setCurrentFolderId] = useState(null);
    const [folderPath, setFolderPath] = useState([]); // [{id, name}, ...]

    // New Dashboard State


    // Pagination State
    const [currentVisitsPage, setCurrentVisitsPage] = useState(1);
    const visitsPerPage = 10;

    const resourceTypes = [
        "Moda Tower 2024 version 2",
        "Moda Tabletop 2024 version 1",
        "Ascale Tower 2023 version1",
        "Ascale Tabletop 2023 version 1",
        "Ascale A&D Box 2023 version 1",
        "Radianz Tower 2023 version 1",
        "Radianz Tabletop 2023 version 1",
        "Moda Tower 2023 version 1",
        "Moda Misc. Samples",
        "Radianz Misc. Samples",
        "Ascale Misc. Samples",
        "Moda Sample Binder SouthV1 12",
        "Moda Sample Binder SouthEast V1 12",
        "Moda Sample Binder NorthWest V1 12",
        "2025V3 Moda Tower Updated 24>25",
        "2025V3 Moda Tower"
    ];

    useEffect(() => {
        fetchCurrentUser();
        fetchCustomers();
        // fetchDashboardResources will be called by its own useEffect when tab is active

        // Auto-refresh every 5 seconds for real-time updates
        const intervalId = setInterval(() => {
            fetchCustomers();
        }, 5000); // 5 seconds

        // Cleanup interval on unmount
        return () => clearInterval(intervalId);
    }, []);

    // Auto-select first customer only if dashboard is not active
    useEffect(() => {
        if (!showDashboard && customers.length > 0 && !selectedCustomerId) {
            setSelectedCustomerId(customers[0]._id);
        }
    }, [customers, selectedCustomerId, showDashboard]);

    const fetchCurrentUser = async () => {
        try {
            // Try to get admin/user info first
            const userResponse = await fetch(`${API_URL}/api/user/me`, {
                credentials: 'include'
            });

            if (userResponse.ok) {
                const userData = await userResponse.json();
                setCurrentUserId(userData.id);
                return;
            }

            // Try customer endpoint as fallback
            const customerResponse = await fetch(`${API_URL}/api/customer/me`, {
                credentials: 'include'
            });

            if (customerResponse.ok) {
                const customerData = await customerResponse.json();
                setCurrentUserId(customerData.id);
            }
        } catch (error) {
            console.error('Error fetching current user:', error);
        }
    };

    // Safe date formatter to prevent crashes
    const formatDate = (dateString, options = {}) => {
        if (!dateString) return '-';
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return 'Invalid Date';

            // Check if it's a date-only string (YYYY-MM-DD or midnight UTC)
            // If it's a pure date (midnight UTC), use UTC timezone for formatting to avoid shift
            const isMidnightUTC = date.getUTCHours() === 0 &&
                date.getUTCMinutes() === 0 &&
                date.getUTCSeconds() === 0 &&
                date.getUTCMilliseconds() === 0;

            if (isMidnightUTC) {
                return date.toLocaleString('en-US', { ...options, timeZone: 'UTC' });
            }

            return date.toLocaleString('en-US', options);
        } catch (e) {
            console.error('Date parsing error:', e);
            return 'Error';
        }
    };

    // Fetch Sales Dashboard Resources
    const fetchDashboardResources = async () => {
        try {
            const query = currentFolderId ? `?parentId=${currentFolderId}` : '';
            const response = await fetch(`${API_URL}/api/sales-dashboard/resources${query}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (response.ok) {
                const data = await response.json();
                setSalesResources(data);
            }
        } catch (error) {
            console.error('Error fetching dashboard resources:', error);
        }
    };

    useEffect(() => {
        if (showDashboard) {
            fetchDashboardResources();
        }
    }, [showDashboard, currentFolderId]);

    const handleGoHome = () => {
        setSelectedCustomerId(null);
        setSelectedCustomerDetail(null);

        // Clear URL
        const newUrl = new URL(window.location);
        newUrl.searchParams.delete('customer');
        window.history.pushState({}, '', newUrl);
        setShowDashboard(true);
        if (isMobile) {
            setIsSidebarOpen(false);
        }
    };

    const fetchCustomers = async () => {
        try {
            const response = await fetch(`${API_URL}/api/customers`, {
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                setCustomers(data);
            } else {
                if (response.status === 401) {
                    // Redirect to admin login if unauthorized
                    window.location.href = '/login';
                    return;
                }
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to fetch customers');
            }
        } catch (error) {
            console.error('Error fetching customers:', error);
            setError(error.message);
        } finally {
            setLoading(false);
        }
    };

    // Optimized function to fetch only the selected customer
    // Optimized function to fetch only the selected customer details
    const fetchSingleCustomer = async (customerId) => {
        if (!customerId) return;

        try {
            setVisitsLoading(true);
            const response = await fetch(`${API_URL}/api/customers/${customerId}`, {
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                setSelectedCustomerDetail(data);
                setQuickNote(data.quickNote || '');

                // Return data for callers
                return data;

                // Also update the lightweight list entry if needed (e.g. name/company changed)
                // distinct from the full detail view
                setCustomers(prevCustomers =>
                    prevCustomers.map(c => c._id === customerId ? { ...c, ...data } : c)
                );
            }
        } catch (error) {
            console.error('Error fetching customer details:', error);
        } finally {
            setVisitsLoading(false);
        }
    };

    // Use selectedCustomerDetail for the main view, fallback to list item (which might be partial)
    const selectedCustomer = selectedCustomerDetail || customers.find(c => c._id === selectedCustomerId);

    // Filter resources (scoped to selected customer only)
    const customerResources = selectedCustomer ? (selectedCustomer.resources || []) : [];

    // Simplified resources (no search filtering)
    const customerFilteredResources = customerResources;

    const filteredCustomers = (Array.isArray(customers) ? customers : [])
        .filter(c => {
            const searchLower = searchTerm.toLowerCase();
            const contactName = c.contactName || `${c.firstName || ''} ${c.lastName || ''}`.trim();
            return (contactName && contactName.toLowerCase().includes(searchLower)) ||
                (c.email?.toLowerCase() || '').includes(searchLower) ||
                (c.company && c.company.toLowerCase().includes(searchLower));
        })
        .sort((a, b) => {
            const nameA = a.company || a.contactName || `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.email || '';
            const nameB = b.company || b.contactName || `${b.firstName || ''} ${b.lastName || ''}`.trim() || b.email || '';
            return nameA.localeCompare(nameB);
        });

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const customerId = params.get('customer');
        if (customerId) {
            setSelectedCustomerId(customerId);
        }
    }, []);

    useEffect(() => {
        if (selectedCustomerId) {
            fetchSingleCustomer(selectedCustomerId);
        }
    }, [selectedCustomerId]);

    const handleSelectCustomer = (customer) => {
        // Only clear previous details if selecting a DIFFERENT customer
        if (selectedCustomerId !== customer._id) {
            setSelectedCustomerDetail(null); // Clear previous details to show loading/fallback
        }
        setSelectedCustomerId(customer._id);

        // Update URL
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('customer', customer._id);
        window.history.pushState({}, '', newUrl);

        // On mobile, close sidebar (list view) to show details
        if (isMobile) {
            setIsSidebarOpen(false);
        }
        // fetchSingleCustomer is triggered by useEffect
        setActiveTab('visits');
        window.scrollTo(0, 0);
    };

    const handleMobileBack = () => {
        setIsSidebarOpen(true); // Show list
        // Optional: clear selection if you want to unmount details, but keeping it keeps state
        // setSelectedCustomerId(null);
    };

    const getPriceLevelLabel = (level) => {
        const labels = {
            1: 'Level 1 (40% Margin)',
            2: 'Level 2 (30% Margin)',
            3: 'Level 3 (20% Margin)',
            4: 'Level 4 (10% Margin)'
        };
        return labels[level] || 'Level 1 (40% Margin)';
    };

    // Contact CRUD operations
    const handleAddContact = () => {
        setEditingContact(null);
        setContactForm({
            name: '',
            phone: '',
            email: '',
            role: '',
            isPrimary: false,
            notes: ''
        });
        setShowContactModal(true);
    };

    const handleEditContact = (contact) => {
        setEditingContact(contact);
        setContactForm({
            name: contact.name || '',
            phone: contact.phone || '',
            email: contact.email || '',
            role: contact.role || '',
            isPrimary: contact.isPrimary || false,
            notes: contact.notes || ''
        });
        setShowContactModal(true);
    };

    const handleSaveContact = async () => {
        try {
            setIsSaving(true);
            const url = editingContact
                ? `${API_URL}/api/customers/${selectedCustomerId}/contacts/${editingContact._id}`
                : `${API_URL}/api/customers/${selectedCustomerId}/contacts`;

            const method = editingContact ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(contactForm)
            });

            if (response.ok) {
                await fetchSingleCustomer(selectedCustomerId);
                setShowContactModal(false);
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to save contact');
            }
        } catch (error) {
            console.error('Error saving contact:', error);
            alert('Failed to save contact');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteContact = async (contactId) => {
        setDeleteConfirmation({
            isOpen: true,
            type: 'contact',
            id: contactId,
            message: 'Are you sure you want to delete this contact?'
        });
    };

    const confirmDelete = async () => {
        const { type, id, customerId } = deleteConfirmation;
        // Use the customerId from state, or fallback to selectedCustomerId for legacy calls
        const targetCustomerId = customerId || selectedCustomerId;

        setDeleteConfirmation({ isOpen: false, type: '', id: null, customerId: null, message: '' });

        if (!targetCustomerId) {
            console.error('No customer ID provided for deletion');
            alert(`Failed to delete ${type}: Missing customer information`);
            return;
        }

        try {
            let response;

            if (type === 'contact') {
                response = await fetch(`${API_URL}/api/customers/${targetCustomerId}/contacts/${id}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
            } else if (type === 'visit') {
                response = await fetch(`${API_URL}/api/customers/${targetCustomerId}/visits/${id}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
            } else if (type === 'resource') {
                response = await fetch(`${API_URL}/api/customers/${targetCustomerId}/resources/${id}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
            }

            if (response && response.ok) {
                await fetchSingleCustomer(targetCustomerId);
            } else {
                alert(`Failed to delete ${type}`);
            }
        } catch (error) {
            console.error(`Error deleting ${type}:`, error);
            alert(`Failed to delete ${type}`);
        }
    };

    const cancelDelete = () => {
        setDeleteConfirmation({ isOpen: false, type: '', id: null, customerId: null, message: '' });
    };

    const handleSaveQuickNote = async () => {
        if (!selectedCustomerId) return;

        setIsSavingNote(true);
        try {
            const response = await fetch(`${API_URL}/api/customers/${selectedCustomerId}/quick-note`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ quickNote })
            });

            if (response.ok) {
                const data = await response.json();
                // Update local state so UI reflects the saved note immediately
                if (selectedCustomerDetail) {
                    setSelectedCustomerDetail({ ...selectedCustomerDetail, quickNote: data.quickNote });
                }
                console.log('Quick note saved successfully');
            } else {
                console.error('Failed to save quick note');
            }
        } catch (error) {
            console.error('Error saving quick note:', error);
        } finally {
            setIsSavingNote(false);
        }
    };

    const handleDashboardUpload = async (e) => {
        e.preventDefault();

        // Validation: For NEW resources of type file, file is required.
        // For EDITING, file is optional UNLESS the existing one was explicitly removed.
        if (dashboardUploadForm.type === 'file') {
            if (!dashboardUploadForm.file) {
                if (!editingDashboardResource || isExistingFileRemoved) {
                    alert('Please select a file to upload');
                    return;
                }
            }
        }

        // Basic validation for name
        if (!dashboardUploadForm.name.trim()) {
            alert('Please provide a name for the resource.');
            return;
        }

        // Validation for link type
        if (dashboardUploadForm.type === 'link' && !dashboardUploadForm.content.trim()) {
            alert('Please provide a URL for the link resource.');
            return;
        }

        setIsSaving(true);
        try {
            const formData = new FormData();
            formData.append('name', dashboardUploadForm.name);
            formData.append('type', dashboardUploadForm.type);
            if (currentFolderId) {
                formData.append('parentId', currentFolderId);
            }

            if (dashboardUploadForm.type === 'link') {
                formData.append('content', dashboardUploadForm.content);
            } else if (dashboardUploadForm.file) { // Only append file if it exists (for new or updated files)
                formData.append('file', dashboardUploadForm.file);

                // Client-side thumbnail generation for images
                if (dashboardUploadForm.file.type.startsWith('image/')) {
                    try {
                        const createThumbnail = (file) => {
                            return new Promise((resolve) => {
                                const reader = new FileReader();
                                reader.onload = (e) => {
                                    const img = new Image();
                                    img.onload = () => {
                                        const canvas = document.createElement('canvas');
                                        const MAX_WIDTH = 200;
                                        const scaleSize = MAX_WIDTH / img.width;
                                        canvas.width = MAX_WIDTH;
                                        canvas.height = img.height * scaleSize;
                                        const ctx = canvas.getContext('2d');
                                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                                        resolve(canvas.toDataURL(file.type));
                                    };
                                    img.src = e.target.result;
                                };
                                reader.readAsDataURL(file);
                            });
                        };

                        const thumbDataUrl = await createThumbnail(dashboardUploadForm.file);
                        formData.append('thumbnail', thumbDataUrl);
                    } catch (error) {
                        console.error('Thumbnail generation failed:', error);
                    }
                }
            }

            const url = editingDashboardResource
                ? `/api/sales-dashboard/resources/${editingDashboardResource._id}`
                : '/api/sales-dashboard/upload';

            const method = editingDashboardResource ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method: method,
                body: formData // Content-Type is set automatically
            });

            if (response.ok) {
                setShowDashboardUploadModal(false);
                setDashboardUploadForm({ name: '', type: 'file', content: '', file: null });
                setEditingDashboardResource(null);
                fetchDashboardResources();
            } else {
                const errorData = await response.json();
                alert(`Failed to ${editingDashboardResource ? 'update' : 'upload'} resource: ${errorData.message}`);
            }
        } catch (error) {
            console.error('Upload/Update error:', error);
            alert(`Error processing request: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDashboardDelete = async (resourceId) => {
        if (!window.confirm('Are you sure you want to delete this resource?')) return;
        try {
            const response = await fetch(`/api/sales-dashboard/resources/${resourceId}`, { method: 'DELETE' });
            if (response.ok) {
                fetchDashboardResources();
            } else {
                alert('Failed to delete resource');
            }
        } catch (error) {
            console.error('Delete error:', error);
        }
    };

    const ensureResourceContent = async (resource) => {
        if (resource.isFolder || resource.type === 'link') return resource;
        if (resource.content) return resource;

        try {
            const response = await fetch(`${API_URL}/api/sales-dashboard/resources/${resource._id}`);
            if (response.ok) {
                const fullResource = await response.json();
                // Update local list state so we don't have to fetch again
                setSalesResources(prev => prev.map(r => r._id === fullResource._id ? fullResource : r));
                return fullResource;
            }
        } catch (error) {
            console.error('Error fetching full resource:', error);
        }
        return resource;
    };

    const handleDashboardShare = async (resource) => {
        try {
            const fullResource = await ensureResourceContent(resource);
            if (fullResource.type === 'link') {
                if (navigator.share) {
                    await navigator.share({
                        title: fullResource.name,
                        text: `Check out this resource: ${fullResource.name}`,
                        url: fullResource.content
                    });
                } else {
                    await navigator.clipboard.writeText(fullResource.content);
                    alert('Link copied to clipboard!');
                }
            } else {
                // Handle File Sharing
                if (navigator.share && fullResource.content && (fullResource.content.startsWith('data:') || fullResource.content.startsWith('/uploads/'))) {
                    // Convert Base64 or URL to Blob/File
                    const resourceUrl = fullResource.content.startsWith('data:')
                        ? fullResource.content
                        : (fullResource.content.startsWith('/') ? `${API_URL}${fullResource.content}` : fullResource.content);

                    const response = await fetch(resourceUrl);
                    const blob = await response.blob();
                    const file = new File([blob], fullResource.name, { type: blob.type });

                    if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        await navigator.share({
                            files: [file],
                            title: fullResource.name,
                            text: `Check out this file: ${fullResource.name}`
                        });
                    } else {
                        throw new Error('Direct file sharing not supported');
                    }
                } else {
                    throw new Error('Web Share API not supported or invalid content');
                }
            }
        } catch (error) {
            console.error('Share failed:', error);
            // Fallback
            if (resource.type === 'link') {
                try {
                    await navigator.clipboard.writeText(resource.content);
                    alert('Link copied to clipboard (Sharing failed or not supported)');
                } catch (e) { alert('Failed to copy link'); }
            } else {
                if (window.confirm('Direct sharing is not supported on this browser or device. Would you like to download the file instead?')) {
                    handleDashboardDownload(resource);
                }
            }
        }
    };

    const handleDashboardDownload = async (resource) => {
        const fullResource = await ensureResourceContent(resource);
        if (fullResource.type === 'link') {
            window.open(fullResource.content, '_blank');
        } else {
            const link = document.createElement('a');
            link.href = fullResource.content.startsWith('data:')
                ? fullResource.content
                : (fullResource.content.startsWith('/') ? `${API_URL}${fullResource.content}` : fullResource.content);
            link.download = fullResource.name || 'download';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const handleDashboardPreview = async (resource) => {
        const fullResource = await ensureResourceContent(resource);
        if (fullResource.type === 'link') {
            window.open(fullResource.content, '_blank');
        } else {
            setPreviewDashboardResource(fullResource);
        }
    };

    // Visit CRUD operations
    const handleAddVisit = () => {
        setEditingVisit(null);
        setIsViewingVisit(false);
        setVisitForm({
            date: formatForDateInput(new Date()),
            purpose: 'Scheduled in Person Sales Meeting',
            notes: '',
            outcome: '',
            nextAction: ''
        });
        setShowVisitModal(true);
    };

    const handleEditVisit = async (visit) => {
        if (!visit?.customerId || !visit?._id) {
            setEditingVisit(visit);
            setIsViewingVisit(false);
            setVisitForm({
                date: visit.date ? formatForDateInput(visit.date) : '',
                purpose: visit.purpose || '',
                notes: visit.notes || '',
                outcome: visit.outcome || '',
                followUp: visit.followUp || visit.nextAction || '',
                managerComment: visit.managerComment || '',
                headquartersComment: visit.headquartersComment || '',
                image: Array.isArray(visit.image) ? visit.image : (visit.image ? [visit.image] : []),
                customerId: visit.customerId || selectedCustomerId || ''
            });
            setShowVisitModal(true);
            return;
        }

        setLoadingVisitId(visit._id);
        try {
            const response = await fetch(`${API_URL}/api/customers/${visit.customerId}/visits/${visit._id}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            const data = await response.json();

            if (data && data.visit) {
                setVisitForm(data.visit);
                setEditingVisit(data.visit);
            } else {
                setVisitForm(visit);
                setEditingVisit(visit);
            }
            setIsViewingVisit(false);
            setShowVisitModal(true);
        } catch (error) {
            console.error('Error fetching visit details for edit:', error);
            setVisitForm(visit);
            setEditingVisit(visit);
            setIsViewingVisit(false);
            setShowVisitModal(true);
        } finally {
            setLoadingVisitId(null);
        }
    };

    const handleViewVisit = async (visit) => {
        if (!visit?.customerId || !visit?._id) {
            setVisitForm(visit || {});
            setEditingVisit(visit);
            setShowVisitModal(true);
            setIsViewingVisit(true);
            return;
        }

        setLoadingVisitId(visit._id);
        try {
            const response = await fetch(`${API_URL}/api/customers/${visit.customerId}/visits/${visit._id}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            const data = await response.json();
            console.log("[DEBUG] Fetched full visit data:", data);

            if (data && data.visit) {
                setVisitForm(data.visit);
                setEditingVisit(data.visit);
            } else {
                setVisitForm(visit);
                setEditingVisit(visit);
            }
            setShowVisitModal(true);
            setIsViewingVisit(true);
        } catch (error) {
            console.error('Error fetching visit details:', error);
            setVisitForm(visit);
            setEditingVisit(visit);
            setShowVisitModal(true);
            setIsViewingVisit(true);
        } finally {
            setLoadingVisitId(null);
        }
    };

    const handleCloseVisitModal = () => {
        setVisitForm({
            date: '',
            purpose: 'Scheduled in Person Sales Meeting',
            notes: '',
            outcome: '',
            followUp: '',
            image: []
        });
        setEditingVisit(null);
        setIsViewingVisit(false);
        setShowVisitModal(false);
    };

    const handleSaveVisit = async () => {
        const targetCustomerId = visitForm.customerId || selectedCustomerId;
        if (!targetCustomerId || !visitForm.date || !visitForm.purpose) {
            alert('Please fill in all mandatory fields (Customer, Date, Visit Type)');
            return;
        }

        try {
            setIsSaving(true);

            if (!targetCustomerId) {
                alert('No customer selected');
                setIsSaving(false);
                return;
            }

            const url = editingVisit
                ? `${API_URL}/api/customers/${targetCustomerId}/visits/${editingVisit._id}`
                : `${API_URL}/api/customers/${targetCustomerId}/visits`;

            const method = editingVisit ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(visitForm)
            });

            if (response.ok) {
                if (selectedCustomerId && targetCustomerId === selectedCustomerId) {
                    await fetchSingleCustomer(selectedCustomerId);
                } else {
                    await fetchCustomers();
                }
                handleCloseVisitModal();
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to save visit');
            }
        } catch (error) {
            console.error('Error saving visit:', error);
            alert('Failed to save visit');
        } finally {
            setIsSaving(false);
        }
    };

    const handleQuickAddVisit = () => {
        setEditingVisit(null);
        setIsViewingVisit(false);

        const localDate = formatForDateInput(new Date());

        setVisitForm({
            date: localDate,
            purpose: 'Scheduled in Person Sales Meeting',
            notes: '',
            outcome: '',
            followUp: '',
            managerComment: '',
            headquartersComment: '',
            image: [],
            customerId: selectedCustomerId || '' // Default to selected customer if available
        });
        setShowVisitModal(true);
    };
    const handleQuickAddResource = () => {
        setEditingResource(null);
        setIsViewingResource(false);

        const localDate = formatForDateInput(new Date());

        setResourceForm({
            title: '',
            date: localDate,
            customerId: '',
            customer: '',
            location: '',
            resourceType: '',
            image: [],
            description: '',
            notes: '',
            status: 'Active',
            url: '',
            uploadedBy: ''
        });
        setShowResourceModal(true);
    };


    const handleDeleteVisit = async (visitId, customerId = null) => {
        setDeleteConfirmation({
            isOpen: true,
            type: 'visit',
            id: visitId,
            customerId: customerId || selectedCustomerId,
            message: 'Are you sure you want to delete this visit?'
        });
    };

    // Resource CRUD operations
    const handleCloseResourceModal = () => {
        setShowResourceModal(false);
        setEditingResource(null);
        setIsViewingResource(false);
        setResourceForm({
            title: '',
            date: formatForDateInput(new Date()),
            customerId: selectedCustomer ? selectedCustomer._id : '',
            customer: selectedCustomer ? (selectedCustomer.company || selectedCustomer.contactName) : '',
            location: '',
            resourceType: '',
            image: [],
            description: '',
            notes: '',
            status: 'Active',
            url: '',
            uploadedBy: ''
        });
    };

    const handleAddResource = () => {
        setEditingResource(null);
        setIsViewingResource(false);
        setImagePreview(null);
        setResourceForm({
            title: '',
            date: formatForDateInput(new Date()),
            customerId: selectedCustomer ? selectedCustomer._id : '',
            customer: selectedCustomer ? (selectedCustomer.company || selectedCustomer.contactName) : '',
            location: '',
            resourceType: '',
            image: [],
            description: '',
            notes: '',
            status: 'Active',
            url: '',
            uploadedBy: ''
        });
        setShowResourceModal(true);
    };

    const handleCreateFolder = async () => {
        const folderName = prompt('Enter folder name:');
        if (!folderName || !folderName.trim()) return;

        try {
            const response = await fetch(`${API_URL}/api/sales-dashboard/upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: folderName.trim(),
                    type: 'folder',
                    isFolder: true,
                    parentId: currentFolderId
                })
            });

            if (response.ok) {
                fetchDashboardResources();
            } else {
                alert('Failed to create folder');
            }
        } catch (error) {
            console.error('Error creating folder:', error);
            alert('Error creating folder');
        }
    };

    const handleFolderClick = (folder) => {
        setFolderPath([...folderPath, { id: folder._id, name: folder.name }]);
        setCurrentFolderId(folder._id);
    };

    const handleFileClick = (resource) => {
        handleDashboardPreview(resource);
    };

    const handleBreadcrumbClick = (index) => {
        if (index === -1) {
            // Home
            setFolderPath([]);
            setCurrentFolderId(null);
        } else {
            // Go to specific folder
            const newPath = folderPath.slice(0, index + 1);
            setFolderPath(newPath);
            setCurrentFolderId(newPath[newPath.length - 1].id);
        }
    };

    const handleResourceClick = async (resource) => {
        if (resource.isFolder) {
            handleFolderClick(resource);
        } else {
            // Lazy load content if missing
            let fullResource = resource;
            if (!resource.content && resource.type !== 'link') {
                try {
                    const response = await fetch(`${API_URL}/api/sales-dashboard/resources/${resource._id}`);
                    if (response.ok) {
                        fullResource = await response.json();
                        // Update local state to avoid re-fetching immediately (optional optimization)
                        setSalesResources(prev => prev.map(r => r._id === fullResource._id ? fullResource : r));
                    } else {
                        alert('Failed to load resource content');
                        return;
                    }
                } catch (error) {
                    console.error('Error fetching full resource:', error);
                    alert('Error loading resource');
                    return;
                }
            }
            handleDashboardPreview(fullResource);
        }
    };

    const handleEditResource = async (resource) => {
        if (!resource?.customerId || !resource?._id) {
            setEditingResource(resource);
            setIsViewingResource(false);
            setImagePreview(Array.isArray(resource.image) && resource.image.length > 0 ? resource.image[0] : (resource.image || null));
            setResourceForm({
                title: resource.title || '',
                date: resource.date ? formatForDateInput(resource.date) : formatForDateInput(new Date()),
                customerId: resource.customerId || selectedCustomerId, // Fallback to current if missing
                customer: resource.customer || '',
                location: resource.location || '',
                resourceType: resource.resourceType || '',
                image: Array.isArray(resource.image) ? resource.image : (resource.image ? [resource.image] : []),
                description: resource.description || '',
                notes: resource.notes || '',
                status: resource.status || 'Active',
                url: resource.url || '',
                uploadedBy: resource.uploadedBy || ''
            });
            setShowResourceModal(true);
            return;
        }

        setLoadingResourceId(resource._id);
        try {
            const response = await fetch(`${API_URL}/api/customers/${resource.customerId}/resources/${resource._id}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            const data = await response.json();

            if (data && data.resource) {
                setResourceForm(data.resource);
                setEditingResource(data.resource);
                setImagePreview(Array.isArray(data.resource.image) && data.resource.image.length > 0 ? data.resource.image[0] : (data.resource.image || null));
            } else {
                setResourceForm(resource);
                setEditingResource(resource);
                setImagePreview(Array.isArray(resource.image) && resource.image.length > 0 ? resource.image[0] : (resource.image || null));
            }
            setIsViewingResource(false);
            setShowResourceModal(true);
        } catch (error) {
            console.error('Error fetching resource details for edit:', error);
            setResourceForm(resource);
            setEditingResource(resource);
            setIsViewingResource(false);
            setShowResourceModal(true);
        } finally {
            setLoadingResourceId(null);
        }
    };

    const handleViewResource = async (resource) => {
        if (!resource?.customerId || !resource?._id) {
            setResourceForm(resource || {});
            setEditingResource(resource);
            setImagePreview(Array.isArray(resource.image) && resource.image.length > 0 ? resource.image[0] : (resource.image || null));
            setShowResourceModal(true);
            setIsViewingResource(true);
            return;
        }

        setLoadingResourceId(resource._id);
        try {
            const response = await fetch(`${API_URL}/api/customers/${resource.customerId}/resources/${resource._id}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            const data = await response.json();

            if (data && data.resource) {
                setResourceForm(data.resource);
                setEditingResource(data.resource);
                setImagePreview(Array.isArray(data.resource.image) && data.resource.image.length > 0 ? data.resource.image[0] : (data.resource.image || null));
            } else {
                setResourceForm(resource);
                setEditingResource(resource);
                setImagePreview(Array.isArray(resource.image) && resource.image.length > 0 ? resource.image[0] : (resource.image || null));
            }
            setShowResourceModal(true);
            setIsViewingResource(true);
        } catch (error) {
            console.error('Error fetching resource details:', error);
            setResourceForm(resource);
            setEditingResource(resource);
            setShowResourceModal(true);
            setIsViewingResource(true);
        } finally {
            setLoadingResourceId(null);
        }
    };

    const handleSaveResource = async () => {
        try {
            setIsSaving(true);
            // Use the selected customer ID from the form, or fallback to the currently selected customer
            const targetCustomerId = resourceForm.customerId || selectedCustomerId;

            if (!targetCustomerId) {
                alert('Please select a client');
                setIsSaving(false);
                return;
            }

            const url = editingResource
                ? `${API_URL}/api/customers/${targetCustomerId}/resources/${editingResource._id}`
                : `${API_URL}/api/customers/${targetCustomerId}/resources`;

            const method = editingResource ? 'PUT' : 'POST';
            console.log('Saving resource - Method:', method, 'Editing:', editingResource);

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(resourceForm)
            });

            if (response.ok) {
                await fetchSingleCustomer(targetCustomerId);
                handleCloseResourceModal();
            } else {
                const data = await response.json();
                console.error('Save resource failed:', data);
                alert(`Failed to save resource: ${data.message || 'Unknown server error'}`);
            }
        } catch (error) {
            console.error('Error saving resource:', error);
            alert(`Failed to save resource: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteResource = async (resourceId, customerId = null) => {
        setDeleteConfirmation({
            isOpen: true,
            type: 'resource',
            id: resourceId,
            customerId: customerId || selectedCustomerId,
            message: 'Are you sure you want to delete this resource?'
        });
    };

    // Reaction handler
    const handleReaction = async (visitId, type) => {
        console.log('handleReaction called:', { visitId, type, selectedCustomerId });
        if (!selectedCustomerId || !visitId) {
            console.error('Missing required IDs for reaction:', { selectedCustomerId, visitId });
            return;
        }

        try {
            const response = await fetch(`${API_URL}/api/customers/${selectedCustomerId}/visits/${visitId}/react`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ type })
            });

            if (response.ok) {
                // Refresh data to show new reaction
                // Using fetchSingleCustomer for now, could be optimized to local state update
                const data = await response.json();

                // Optimistic update or just simpler refetch
                await fetchSingleCustomer(selectedCustomerId);
            } else {
                console.error('Failed to update reaction');
            }
        } catch (error) {
            console.error('Error updating reaction:', error);
        }
    };

    // Image compression utility
    const compressImage = async (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    const MAX_WIDTH = 1200;
                    const MAX_HEIGHT = 1200;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Compress to JPEG with 0.7 quality
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                    resolve(dataUrl);
                };
                img.onerror = (error) => reject(error);
            };
            reader.onerror = (error) => reject(error);
        });
    };

    // Generic file to Base64 utility for PDFs
    const fileToBase64 = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = (error) => reject(error);
        });
    };

    const handleVisitImageUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        const newFiles = [];
        for (const file of files) {
            if (file.size > 25 * 1024 * 1024) {
                alert(`File ${file.name} is too large. Limit is 25MB.`);
                continue;
            }
            try {
                let processedFile;
                if (file.type.startsWith('image/')) {
                    processedFile = await compressImage(file);
                } else if (file.type === 'application/pdf') {
                    processedFile = await fileToBase64(file);
                } else {
                    alert(`Unsupported file type: ${file.name}`);
                    continue;
                }
                newFiles.push(processedFile);
            } catch (error) {
                console.error(`Error processing ${file.name}:`, error);
                alert(`Failed to process file ${file.name}`);
            }
        }

        setVisitForm(prev => ({
            ...prev,
            image: prev.image ? (Array.isArray(prev.image) ? [...prev.image, ...newFiles] : [prev.image, ...newFiles]) : newFiles
        }));
    };

    const handlePaste = async (e) => {
        const items = e.clipboardData.items;
        const newFiles = [];
        let hasFile = false;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file) {
                    hasFile = true;
                    // Check file type
                    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
                        continue;
                    }

                    if (file.size > 25 * 1024 * 1024) {
                        alert(`Pasted file is too large. Limit is 25MB.`);
                        continue;
                    }

                    try {
                        let processedFile;
                        if (file.type.startsWith('image/')) {
                            processedFile = await compressImage(file);
                        } else if (file.type === 'application/pdf') {
                            processedFile = await fileToBase64(file);
                        }
                        if (processedFile) {
                            newFiles.push(processedFile);
                        }
                    } catch (error) {
                        console.error(`Error processing pasted file:`, error);
                    }
                }
            }
        }

        if (hasFile && newFiles.length > 0) {
            e.preventDefault(); // Prevent default if we successfully handled a file
            setVisitForm(prev => ({
                ...prev,
                image: prev.image ? (Array.isArray(prev.image) ? [...prev.image, ...newFiles] : [prev.image, ...newFiles]) : newFiles
            }));
        }
    };

    const handleRemoveVisitImage = (index) => {
        setVisitForm(prev => ({
            ...prev,
            image: prev.image.filter((_, i) => i !== index)
        }));
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!fullScreenImage) return;
            if (e.key === 'ArrowRight') handleNextImage();
            if (e.key === 'ArrowLeft') handlePrevImage();
            if (e.key === 'Escape') setFullScreenImage(null);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [fullScreenImage, fullScreenIndex, fullScreenGallery]);

    const handleOpenGallery = (images, index) => {
        const imageList = Array.isArray(images) ? images : [images];
        setFullScreenGallery(imageList);
        setFullScreenIndex(index);
        setFullScreenImage(imageList[index]);
    };

    const handleNextImage = () => {
        if (fullScreenGallery.length <= 1) return;
        const nextIndex = (fullScreenIndex + 1) % fullScreenGallery.length;
        setFullScreenIndex(nextIndex);
        setFullScreenImage(fullScreenGallery[nextIndex]);
    };

    const handlePrevImage = () => {
        if (fullScreenGallery.length <= 1) return;
        const prevIndex = (fullScreenIndex - 1 + fullScreenGallery.length) % fullScreenGallery.length;
        setFullScreenIndex(prevIndex);
        setFullScreenImage(fullScreenGallery[prevIndex]);
    };

    // Resource Image/File upload handler
    const handleImageUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        const newFiles = [];
        for (const file of files) {
            if (file.size > 25 * 1024 * 1024) {
                alert(`File ${file.name} is too large. Limit is 25MB.`);
                continue;
            }
            try {
                let processedFile;
                if (file.type.startsWith('image/')) {
                    processedFile = await compressImage(file);
                } else if (file.type === 'application/pdf') {
                    processedFile = await fileToBase64(file);
                } else {
                    alert(`Unsupported file type: ${file.name}`);
                    continue;
                }
                newFiles.push(processedFile);
            } catch (error) {
                console.error(`Error processing ${file.name}:`, error);
                alert(`Failed to process file ${file.name}`);
            }
        }

        if (newFiles.length === 0) return;

        setResourceForm(prev => ({
            ...prev,
            image: prev.image ? (Array.isArray(prev.image) ? [...prev.image, ...newFiles] : [prev.image, ...newFiles]) : newFiles
        }));

        // Set preview for the first file if not already set
        if (!imagePreview && newFiles.length > 0) {
            setImagePreview(newFiles[0]);
        }
    };

    const handleRemoveResourceImage = (index) => {
        const updatedImages = resourceForm.image.filter((_, i) => i !== index);
        setResourceForm({ ...resourceForm, image: updatedImages });
        setImagePreview(updatedImages.length > 0 ? updatedImages[0] : null);
    };

    const handleRemoveImage = () => {
        setResourceForm({ ...resourceForm, image: '' });
        setImagePreview(null);
    };


    // Dashboard Helpers


    const handleExportVisits = (customVisits) => {
        const visits = customVisits || memoizedFilteredVisits;
        const data = visits.map(v => ({
            Date: formatDate(v.date),
            Customer: v.customerName,
            'Visit Type': v.purpose || '-',
            Notes: v.notes || '-',
            Outcome: v.outcome || '-',
            'Next Action': v.nextAction || '-'
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, "Sales Visits");
        XLSX.writeFile(wb, "Sales_Visits.xlsx");
    };

    const handleExportResources = () => {
        const resources = memoizedFilteredResources;
        const data = resources.map(r => ({
            Date: formatDate(r.date || r.createdAt),
            Customer: r.customerName,
            Type: r.resourceType || '-',
            Description: r.description || r.notes || '-',
            Status: r.status || 'Active'
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, "Client Resources");
        XLSX.writeFile(wb, "Client_Resources.xlsx");
    };


    return (
        <div className="sales-container">
            {/* Sidebar */}
            <div
                className={`sales-sidebar ${isSidebarOpen ? 'open' : 'closed'} ${isPinned ? 'pinned' : 'overlay'}`}
                style={{ width: isMobile ? '100%' : `${sidebarWidth}px` }}
            >
                {/* Resize Handle */}
                {!isMobile && (
                    <div className="resize-handle" onMouseDown={startResizing} />
                )}
                <div className="sidebar-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <h2>Customers</h2>
                        <span className="customer-count">{filteredCustomers.length}</span>
                    </div>
                    <div className="sidebar-controls">
                        <button
                            className="icon-btn-ghost"
                            onClick={handleGoHome}
                            title="Sales Dashboard"
                        >
                            <LayoutDashboard size={18} />
                        </button>
                        <button
                            className="icon-btn-ghost"
                            onClick={togglePin}
                            title={isPinned ? "Unpin Sidebar" : "Pin Sidebar"}
                        >
                            {isPinned ? <Pin size={18} fill="currentColor" /> : <PinOff size={18} />}
                        </button>
                        {!isPinned && (
                            <button
                                className="icon-btn-ghost close-sidebar"
                                onClick={() => setIsSidebarOpen(false)}
                            >
                                <ChevronLeft size={20} />
                            </button>
                        )}
                    </div>
                </div>

                <div className="search-box">
                    <Search size={16} className="search-icon" />
                    <input
                        type="text"
                        placeholder="Search customers..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {searchTerm && (
                        <button
                            onClick={() => setSearchTerm('')}
                            style={{
                                position: 'absolute',
                                right: '10px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                background: 'rgba(255,255,255,0.1)',
                                border: 'none',
                                color: '#9CA3AF',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '4px',
                                borderRadius: '50%',
                                width: '20px',
                                height: '20px'
                            }}
                        >
                            <X size={12} />
                        </button>
                    )}
                </div>

                <div className="customer-list">
                    {loading ? (
                        <div className="skeleton-list">
                            {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                                <div key={i} className="skeleton-item">
                                    <div className="skeleton-thumb skeleton" />
                                    <div className="skeleton-info">
                                        <div className="skeleton-name skeleton" />
                                        <div className="skeleton-meta skeleton" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : error ? (
                        <div className="error-message" style={{ padding: '1.5rem', color: '#ef4444', textAlign: 'center' }}>
                            <p>Failed to load customers</p>
                            <button
                                onClick={() => window.location.reload()}
                                style={{
                                    marginTop: '0.5rem',
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    border: '1px solid rgba(239, 68, 68, 0.2)',
                                    color: '#ef4444',
                                    padding: '0.25rem 0.75rem',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem'
                                }}
                            >
                                Retry
                            </button>
                        </div>
                    ) : filteredCustomers.length === 0 ? (
                        <div className="empty-list-message">
                            No customers found
                        </div>
                    ) : (
                        filteredCustomers.map(customer => (
                            <div
                                key={customer._id}
                                className={`customer-list-item ${selectedCustomerId === customer._id ? 'active' : ''} ${customer.quickNote ? 'has-quick-note' : ''}`}
                                onClick={() => handleSelectCustomer(customer)}
                            >
                                <div className="list-thumb-placeholder">
                                    <User size={20} />
                                </div>
                                <div className="list-info">
                                    <span className="list-name">
                                        {customer.company || customer.contactName || `${customer.firstName} ${customer.lastName}`}
                                        {customer.isActive === false && <span className="inactive-badge">(Inactive)</span>}
                                    </span>
                                    <span className="list-meta">{customer.company || customer.email}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div
                className={`sales-main ${isChatFullScreen ? 'full-screen' : ''} ${!isPinned || !isSidebarOpen ? 'full-width' : ''}`}
                style={{
                    marginLeft: isMobile || !isSidebarOpen || !isPinned ? 0 : `${sidebarWidth}px`,
                    position: 'relative'
                }}
            >
                {/* Header removed from here to be placed inside specific views */}
                <ErrorBoundary key={selectedCustomerId || 'no-customer'}>
                    {selectedCustomer ? (
                        <>
                            {/* Customer Header - Hide in full screen chat */}
                            {!isChatFullScreen && (
                                <div className="customer-header">
                                    <div className="header-main">
                                        <div className="header-left">
                                            {isMobile && (
                                                <button
                                                    className="fancy-mobile-menu-btn"
                                                    onClick={handleMobileBack}
                                                    title="Back to customer list"
                                                >
                                                    <Menu size={24} />
                                                </button>
                                            )}
                                            <div className="name-block">
                                                <h1 className="customer-name">
                                                    {selectedCustomer.company || selectedCustomer.contactName || `${selectedCustomer.firstName} ${selectedCustomer.lastName}`}
                                                </h1>
                                                {isMobile && selectedCustomer.address?.city && (
                                                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#9CA3AF', fontWeight: '500' }}>
                                                        {selectedCustomer.address.city}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="header-tabs">
                                            <button
                                                className={`header-tab ${activeTab === 'visits' ? 'active' : ''}`}
                                                onClick={() => setActiveTab('visits')}
                                            >
                                                Visits
                                            </button>
                                            <button
                                                className={`header-tab ${activeTab === 'resources' ? 'active' : ''}`}
                                                onClick={() => setActiveTab('resources')}
                                            >
                                                Resources
                                            </button>
                                            <button
                                                className={`header-tab ${activeTab === 'contacts' ? 'active' : ''}`}
                                                onClick={() => setActiveTab('contacts')}
                                            >
                                                Contacts
                                            </button>
                                        </div>

                                        <div className="header-right" style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                                            <button
                                                className="info-toggle-btn"
                                                onClick={() => {
                                                    setSelectedCustomerId(null);
                                                    setSelectedCustomerDetail(null);
                                                    navigate('/sales');
                                                }}
                                                title="Sales Dashboard"
                                                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '50%', padding: '6px' }}
                                            >
                                                <LayoutDashboard size={18} />
                                            </button>
                                            <button
                                                className={`info-toggle-btn ${showCustomerInfo ? 'active' : ''}`}
                                                onClick={() => setShowCustomerInfo(!showCustomerInfo)}
                                                title={showCustomerInfo ? 'Hide Info' : 'Show Info'}
                                                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '50%', padding: '6px' }}
                                            >
                                                {showCustomerInfo ? <X size={18} /> : <Info size={18} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Collapsible Info Section - Hide in full screen chat */}
                            {!isChatFullScreen && showCustomerInfo && (
                                <div className="customer-info-section">
                                    {/* Info Boxes Row */}
                                    <div className="info-boxes">
                                        <div className="info-box">
                                            <div className="info-box-header">
                                                <DollarSign size={16} />
                                                <label>Price Level</label>
                                            </div>
                                            <p>{getPriceLevelLabel(selectedCustomer.priceLevel)}</p>
                                        </div>
                                        <div className="info-box">
                                            <div className="info-box-header">
                                                <User size={16} />
                                                <label>Type</label>
                                            </div>
                                            <p>Customer</p>
                                        </div>
                                        <div className="info-box">
                                            <div className="info-box-header">
                                                <ShieldCheck size={16} />
                                                <label>Status</label>
                                            </div>
                                            <p className={selectedCustomer.isActive !== false ? 'status-active' : 'status-inactive'}>
                                                {selectedCustomer.isActive !== false ? 'Active' : 'Inactive'}
                                            </p>
                                        </div>
                                        <div className="info-box">
                                            <div className="info-box-header">
                                                <Calendar size={16} />
                                                <label>Member Since</label>
                                            </div>
                                            <p>{formatDate(selectedCustomer.createdAt, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                                        </div>
                                    </div>

                                    {/* Two Column Layout for Address/Contact */}
                                    <div className="detail-columns simplified">
                                        <div className="detail-column">
                                            <h3><MapPin size={14} style={{ marginRight: '8px' }} />Address</h3>
                                            <div className="column-content">
                                                <p className="address-line">
                                                    {selectedCustomer.address?.street || 'No street address'}
                                                </p>
                                                <p className="address-line">
                                                    {selectedCustomer.address?.city || ''}{selectedCustomer.address?.city && selectedCustomer.address?.state ? ', ' : ''}{selectedCustomer.address?.state || ''} {selectedCustomer.address?.zipCode || ''}
                                                </p>
                                                {!selectedCustomer.address?.city && !selectedCustomer.address?.state && (
                                                    <p className="text-muted">No address provided</p>
                                                )}
                                            </div>
                                        </div>

                                        <div className="detail-column">
                                            <h3><User size={14} style={{ marginRight: '8px' }} />Contact</h3>
                                            <div className="column-content">
                                                <div className="contact-item">
                                                    <Mail size={16} />
                                                    <span>{selectedCustomer.email}</span>
                                                </div>
                                                <div className="contact-item">
                                                    <Phone size={16} />
                                                    <span>{selectedCustomer.phone || 'N/A'}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Quick Notes Row */}
                                    <div className="quick-notes-row">
                                        <div className="quick-notes-header">
                                            <div className="header-label">
                                                <MessageSquare size={14} style={{ marginRight: '8px' }} />
                                                <h3>Quick Notes</h3>
                                            </div>
                                            <button
                                                className={`save-note-btn ${isSavingNote ? 'saving' : ''}`}
                                                onClick={handleSaveQuickNote}
                                                disabled={isSavingNote}
                                            >
                                                {isSavingNote ? 'Saving...' : (selectedCustomerDetail?.quickNote ? 'Edit Quick Note' : 'Save Quick Note')}
                                            </button>
                                        </div>
                                        <textarea
                                            className="quick-notes-textarea"
                                            placeholder="Write a quick note or follow-up note for this customer..."
                                            value={quickNote}
                                            onChange={(e) => setQuickNote(e.target.value)}
                                        />
                                    </div>
                                </div>
                            )}
                            <div className="tab-content">
                                {activeTab === 'contacts' && (
                                    <div className="tab-section contacts-tab">
                                        <div className="tab-header">
                                            <h3>Contacts</h3>
                                            <button className="add-btn" onClick={handleAddContact}>
                                                <Plus size={18} /> Add Contact
                                            </button>
                                        </div>
                                        <div className="data-table">
                                            <table>
                                                <thead>
                                                    <tr>
                                                        <th>Name</th>
                                                        <th>Phone</th>
                                                        <th>Email</th>
                                                        <th>Role</th>
                                                        <th>Primary</th>
                                                        <th>Notes</th>
                                                        <th>Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {selectedCustomer.contacts && selectedCustomer.contacts.length > 0 ? (
                                                        selectedCustomer.contacts.map(contact => (
                                                            <tr key={contact._id}>
                                                                <td data-label="Name">{contact.name}</td>
                                                                <td data-label="Phone">{contact.phone || '-'}</td>
                                                                <td data-label="Email">{contact.email || '-'}</td>
                                                                <td data-label="Role">{contact.role || '-'}</td>
                                                                <td data-label="Primary">{contact.isPrimary ? 'Yes' : 'No'}</td>
                                                                <td data-label="Notes">{contact.notes || '-'}</td>
                                                                <td data-label="Actions">
                                                                    <div className="action-buttons">
                                                                        <button className="icon-btn edit" onClick={() => handleEditContact(contact)}>
                                                                            <Edit2 size={14} />
                                                                        </button>
                                                                        <button className="icon-btn delete" onClick={() => handleDeleteContact(contact._id)}>
                                                                            <Trash2 size={14} />
                                                                        </button>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))
                                                    ) : (
                                                        <tr>
                                                            <td colSpan="7" className="empty-row">No contacts added yet</td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}


                                {activeTab === 'visits' && (
                                    <div className="tab-section visits-tab">
                                        {/* Top "New Post" Input Area */}
                                        {/* Add Visit Button Area */}
                                        <div className="add-visit-container">
                                            <button className="icon-action-btn secondary" onClick={handleAddContact} title="Add Contact">
                                                <UserPlus size={18} />
                                                <span className="btn-label">Add Contact</span>
                                            </button>
                                            <button className="icon-action-btn secondary" onClick={handleAddResource} title="Add Resource">
                                                <FolderPlus size={18} />
                                                <span className="btn-label">Add Resource</span>
                                            </button>
                                            <button className="add-visit-btn" onClick={handleQuickAddVisit}>
                                                <Plus size={18} />
                                                Add Visit
                                            </button>
                                        </div>

                                        <div className="chat-container channel-feed">
                                            <div className="chat-messages feed-list">
                                                {visitsLoading ? (
                                                    <div className="loading-spinner-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', padding: '2rem' }}>
                                                        <Loader className="spin-animation" size={32} color="#E5C04A" />
                                                    </div>
                                                ) : (
                                                    selectedCustomer.visits?.length > 0 ? (
                                                        [...selectedCustomer.visits].reverse().map(visit => {
                                                            return (
                                                                <div key={visit._id} className="visit-post-card">

                                                                    <div className="post-content-area">
                                                                        <div className="post-header">
                                                                            <span className="post-author">{visit.createdByName || visit.creatorName || 'Unknown User'}</span>
                                                                            <span className="post-time">{formatDate(visit.createdAt || visit.date, { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>

                                                                            {(currentUser?.role === 'admin' || currentUser?.role === 'director' || currentUser?.role === 'manager' || currentUserId === visit.createdBy) && (
                                                                                <div className="post-header-actions">
                                                                                    <button
                                                                                        className="icon-action-small reaction-trigger"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            if (activeReactionMessageId === visit._id) {
                                                                                                setActiveReactionMessageId(null);
                                                                                            } else {
                                                                                                setActiveReactionMessageId(visit._id);
                                                                                            }
                                                                                        }}
                                                                                        title="Add Reaction"
                                                                                    >
                                                                                        <Smile size={14} />
                                                                                    </button>
                                                                                    {activeReactionMessageId === visit._id && (
                                                                                        <div className="reaction-picker-floating">
                                                                                            {['👍', '❤️', '😂', '😮', '👏'].map(emoji => (
                                                                                                <button
                                                                                                    key={emoji}
                                                                                                    className="reaction-option"
                                                                                                    onClick={(e) => {
                                                                                                        e.stopPropagation();
                                                                                                        handleReaction(visit._id, emoji);
                                                                                                        setActiveReactionMessageId(null);
                                                                                                    }}
                                                                                                >
                                                                                                    {emoji}
                                                                                                </button>
                                                                                            ))}
                                                                                        </div>
                                                                                    )}
                                                                                    <button
                                                                                        className="icon-action-small edit"
                                                                                        onClick={(e) => { e.stopPropagation(); handleEditVisit(visit); }}
                                                                                        title="Edit"
                                                                                    >
                                                                                        <Edit2 size={14} />
                                                                                    </button>
                                                                                    <button
                                                                                        className="icon-action-small delete"
                                                                                        onClick={(e) => { e.stopPropagation(); handleDeleteVisit(visit._id); }}
                                                                                        title="Delete"
                                                                                    >
                                                                                        <Trash2 size={14} />
                                                                                    </button>
                                                                                </div>
                                                                            )}
                                                                        </div>

                                                                        <div className="post-body">
                                                                            {visit.purpose && <h4 className="post-purpose">{visit.purpose}</h4>}

                                                                            {/* Images */}
                                                                            {visit.image && (Array.isArray(visit.image) ? visit.image : [visit.image]).length > 0 && (
                                                                                <div className={`post-images gallery-layout count-${Math.min((Array.isArray(visit.image) ? visit.image : [visit.image]).length, 4)}`}>
                                                                                    {(Array.isArray(visit.image) ? visit.image : [visit.image]).slice(0, 4).map((img, idx, array) => {
                                                                                        const totalImages = (Array.isArray(visit.image) ? visit.image : [visit.image]).length;
                                                                                        const isLastShown = idx === 3;
                                                                                        const remainingCount = totalImages - 4;

                                                                                        return (
                                                                                            <div
                                                                                                key={idx}
                                                                                                className="post-image-wrapper"
                                                                                                onClick={() => handleOpenGallery(visit.image, idx)}
                                                                                            >
                                                                                                {img.startsWith('data:application/pdf') ? (
                                                                                                    <div className="pdf-attachment-card">
                                                                                                        <FileText size={20} color="#E5C04A" />
                                                                                                        <span>PDF</span>
                                                                                                    </div>
                                                                                                ) : (
                                                                                                    <>
                                                                                                        <img
                                                                                                            src={img}
                                                                                                            alt="Attachment"
                                                                                                            className="post-attachment-img"
                                                                                                        />
                                                                                                        {isLastShown && remainingCount > 0 && (
                                                                                                            <div className="more-images-overlay">
                                                                                                                <span>+{remainingCount}</span>
                                                                                                            </div>
                                                                                                        )}
                                                                                                    </>
                                                                                                )}
                                                                                            </div>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            )}

                                                                            {/* Text Note */}
                                                                            {visit.notes && <p className="post-text">{visit.notes}</p>}

                                                                            {(visit.outcome || visit.followUp || visit.nextAction || visit.managerComment || visit.headquartersComment) && (
                                                                                <div className="post-details-ext">
                                                                                    {visit.outcome && !visit.purpose?.toLowerCase().includes('quick note') && (
                                                                                        <div className="post-detail-row outcome">
                                                                                            <span className="detail-label">Outcome:</span>
                                                                                            <span className="detail-value">{visit.outcome}</span>
                                                                                        </div>
                                                                                    )}
                                                                                    {visit.followUp && !visit.purpose?.toLowerCase().includes('quick note') && (
                                                                                        <div className="post-detail-row follow-up">
                                                                                            <span className="detail-label">Follow Up:</span>
                                                                                            <span className="detail-value">{visit.followUp}</span>
                                                                                        </div>
                                                                                    )}
                                                                                    {visit.managerComment && (
                                                                                        <div className="post-detail-row manager-comment">
                                                                                            <span className="detail-label">Manager Comment:</span>
                                                                                            <span className="detail-value">{visit.managerComment}</span>
                                                                                        </div>
                                                                                    )}
                                                                                    {visit.headquartersComment && (
                                                                                        <div className="post-detail-row hq-comment">
                                                                                            <span className="detail-label">HQ Comment:</span>
                                                                                            <span className="detail-value">{visit.headquartersComment}</span>
                                                                                        </div>
                                                                                    )}
                                                                                    {visit.nextAction && (
                                                                                        <div className="post-detail-row next-action">
                                                                                            <span className="detail-label">Next Steps:</span>
                                                                                            <span className="detail-value">{visit.nextAction}</span>
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </div>

                                                                        {/* Reactions Bar */}
                                                                        <div className="post-reactions">
                                                                            {/* Existing Reactions */}
                                                                            {visit.reactions && visit.reactions.length > 0 && (
                                                                                <div className="existing-reactions">
                                                                                    {Object.entries(
                                                                                        visit.reactions.reduce((acc, r) => {
                                                                                            if (!r || !r.type) return acc;
                                                                                            if (!acc[r.type]) acc[r.type] = { count: 0, userIds: [] };
                                                                                            acc[r.type].count++;
                                                                                            acc[r.type].userIds.push(r.userId);
                                                                                            return acc;
                                                                                        }, {})
                                                                                    ).map(([type, data]) => {
                                                                                        const currentUserId = currentUser?._id || currentUser?.id;
                                                                                        const userReacted = currentUserId && data.userIds.includes(currentUserId.toString());
                                                                                        return (
                                                                                            <span
                                                                                                key={type}
                                                                                                className={`reaction-pill ${userReacted ? 'user-reacted' : ''}`}
                                                                                                title={userReacted ? 'Click to remove your reaction' : `${data.count} reactions`}
                                                                                                onClick={() => userReacted && handleReaction(visit._id, type)}
                                                                                            >
                                                                                                {type} <span className="count">{data.count}</span>
                                                                                                {userReacted && (
                                                                                                    <span className="reaction-remove-icon">
                                                                                                        <X size={10} strokeWidth={3} />
                                                                                                    </span>
                                                                                                )}
                                                                                            </span>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            )}
                                                                        </div>


                                                                    </div>
                                                                </div>
                                                            );
                                                        })
                                                    ) : (
                                                        <div className="empty-list-message">
                                                            No posts yet. Be the first to post!
                                                        </div>
                                                    )
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'resources' && (
                                    <div className="tab-section resources-tab">
                                        {/* Filters Section */}


                                        {/* Header with Title and Add Button */}
                                        <div className="resources-header">
                                            <h2>Client Resource</h2>
                                            <button className="add-resource-btn" onClick={handleAddResource}>
                                                Add Resource 📄
                                            </button>
                                        </div>



                                        {/* Resources Table */}
                                        <div className="resources-table-wrapper">
                                            <table className="resources-table">
                                                <thead>
                                                    <tr>
                                                        <th style={{ width: '50px' }}>#</th>
                                                        <th>Date</th>
                                                        <th>Client</th>
                                                        <th>Location</th>
                                                        <th>Type</th>
                                                        <th style={{ width: '120px' }}>Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {customerFilteredResources && customerFilteredResources.length > 0 ? (
                                                        customerFilteredResources.map((resource, index) => (
                                                            <React.Fragment key={resource._id || index}>
                                                                <tr
                                                                    className={expandedResourceId === resource._id ? 'expanded' : ''}
                                                                    onClick={() => setExpandedResourceId(expandedResourceId === resource._id ? null : resource._id)}
                                                                >
                                                                    <td data-label="#">{index + 1}</td>
                                                                    <td data-label="Date">{formatDate(resource.date, { month: '2-digit', day: '2-digit', year: 'numeric' })}</td>
                                                                    <td data-label="Client">
                                                                        {(() => {
                                                                            const customerObj = customers.find(c => c._id === resource.customerId);
                                                                            return customerObj ? (customerObj.company || customerObj.contactName) : (resource.customer || '-');
                                                                        })()}
                                                                    </td>
                                                                    <td data-label="Location">{resource.location || '-'}</td>
                                                                    <td data-label="Type">{resource.resourceType || '-'}</td>
                                                                    <td data-label="Actions">
                                                                        <div className="action-buttons" onClick={(e) => e.stopPropagation()}>
                                                                            <button className="icon-btn view" onClick={(e) => { e.stopPropagation(); handleViewResource(resource); }} title="View" disabled={loadingResourceId === resource._id}>
                                                                                {loadingResourceId === resource._id ? <Loader size={16} className="animate-spin" /> : <Eye size={16} />}
                                                                            </button>
                                                                            {(currentUser?.role === 'admin' || currentUser?.role === 'director' || currentUser?.role === 'manager' || currentUserId === (resource.uploadedBy || resource.createdBy)) && (
                                                                                <>
                                                                                    <button className="icon-btn edit" onClick={(e) => { e.stopPropagation(); handleEditResource(resource); }} title="Edit">
                                                                                        <Edit2 size={16} />
                                                                                    </button>
                                                                                    <button className="icon-btn delete" onClick={(e) => { e.stopPropagation(); handleDeleteResource(resource._id, resource.customerId); }} title="Delete">
                                                                                        <Trash2 size={16} />
                                                                                    </button>
                                                                                </>
                                                                            )}
                                                                            {resource.url && (
                                                                                <a href={resource.url} target="_blank" rel="noopener noreferrer" className="icon-btn link" onClick={(e) => e.stopPropagation()} title="Open Link">
                                                                                    🔗
                                                                                </a>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                                {expandedResourceId === resource._id && (
                                                                    <tr className="resource-details-row">
                                                                        <td colSpan="6">
                                                                            <div className="resource-details">
                                                                                <div className="detail-item">
                                                                                    <strong>Attachments</strong>
                                                                                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                                                                        {(Array.isArray(resource.image) ? resource.image : (resource.image ? [resource.image] : [])).length > 0 ? (
                                                                                            (Array.isArray(resource.image) ? resource.image : [resource.image]).map((img, idx) => (
                                                                                                img.startsWith('data:application/pdf') ? (
                                                                                                    <div key={idx} style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => {
                                                                                                        const win = window.open();
                                                                                                        win.document.write('<iframe src="' + img + '" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>');
                                                                                                    }}>
                                                                                                        <FileText size={40} color="#E5C04A" />
                                                                                                        <div style={{ fontSize: '10px' }}>PDF</div>
                                                                                                    </div>
                                                                                                ) : (
                                                                                                    <img
                                                                                                        key={idx}
                                                                                                        src={img}
                                                                                                        alt="Resource"
                                                                                                        style={{ maxWidth: '100px', maxHeight: '100px', objectFit: 'cover', cursor: 'pointer', borderRadius: '4px', border: '1px solid #ddd' }}
                                                                                                        onClick={() => setFullScreenImage(img)}
                                                                                                    />
                                                                                                )
                                                                                            ))
                                                                                        ) : (
                                                                                            <span className="placeholder-img">No attachments</span>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                                <div className="detail-item">
                                                                                    <strong>Description</strong>
                                                                                    <p>{resource.description || '-'}</p>
                                                                                </div>
                                                                                <div className="detail-item">
                                                                                    <strong>Notes</strong>
                                                                                    <p>{resource.notes || '-'}</p>
                                                                                </div>
                                                                                <div className="detail-item">
                                                                                    <strong>Status</strong>
                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                                                                                        <span className={`status-badge ${resource.status?.toLowerCase()}`}>
                                                                                            {resource.status || 'Active'}
                                                                                        </span>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                )}
                                                            </React.Fragment>
                                                        ))
                                                    ) : (
                                                        <tr>
                                                            <td colSpan="6" className="empty-row">No resources found</td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>


                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="sales-dashboard-v2">
                            {loading ? (
                                <div className="skeleton-dashboard">
                                    <div className="skeleton-stats">
                                        {[1, 2, 3].map(i => (
                                            <div key={i} className="skeleton-stat-card skeleton" />
                                        ))}
                                    </div>
                                    <div className="skeleton-table skeleton" />
                                </div>
                            ) : (
                                <>
                                    {/* Header */}
                                    <div className="dashboard-header-v2">
                                        <div className="dashboard-header-content">
                                            <div className="dashboard-left-section">
                                                {(!isSidebarOpen || isMobile) && (
                                                    <button
                                                        onClick={() => setIsSidebarOpen(true)}
                                                        className="dashboard-sidebar-toggle"
                                                        title="Open Sidebar"
                                                    >
                                                        <Menu size={20} />
                                                    </button>
                                                )}
                                                <div className="dashboard-title-group">
                                                    <h1>Dashboard</h1>
                                                    <div className="dashboard-breadcrumbs">
                                                        <span className="link" onClick={() => {
                                                            if (folderPath.length > 0) {
                                                                handleBreadcrumbClick(-1);
                                                            }
                                                        }}>Home</span>
                                                        <span>/</span>
                                                        <span className="current">Dashboard</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="dashboard-actions">
                                                <button className="btn-secondary" onClick={handleQuickAddResource} title="Add Resource for any Client">
                                                    + Add Resource
                                                </button>
                                                <button className="btn-primary" onClick={handleQuickAddVisit} title="Add Visit for any Client">
                                                    + Add Visit
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Time Filters */}
                                    <div className="time-range-filters">
                                        {['1day', '7days', '30days', 'year', 'all'].map(range => {
                                            const labels = {
                                                '1day': 'Today',
                                                '7days': 'Last 7 Days',
                                                '30days': 'Last 30 Days',
                                                'year': 'Year-to-date',
                                                'all': 'All'
                                            };
                                            return (
                                                <button
                                                    key={range}
                                                    className={`time-filter-btn ${dashboardTimeRange === range ? 'active' : ''}`}
                                                    onClick={() => setDashboardTimeRange(range)}
                                                >
                                                    {labels[range]}
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {/* Stats Grid */}
                                    {(() => {
                                        const stats = dashboardStats;
                                        const timeLabel = {
                                            '1day': 'Today',
                                            '7days': 'Last 7 Days',
                                            '30days': 'Last 30 Days',
                                            'year': 'Year-to-date',
                                            'all': 'All Time'
                                        }[dashboardTimeRange];

                                        return (
                                            <div className="stats-grid">
                                                <div
                                                    className={`stat-card ${activeDashboardTab === 'visits' ? 'active-tab' : ''}`}
                                                    onClick={() => setActiveDashboardTab('visits')}
                                                    style={{ cursor: 'pointer' }}
                                                >
                                                    <div className="stat-icon-wrapper">
                                                        <UserPlus size={20} />
                                                    </div>
                                                    <div className="stat-title">SALES VISITS</div>
                                                    <div className="stat-value">{stats.visits}</div>
                                                    <div className="stat-footer">{timeLabel}</div>
                                                </div>
                                                {/* <div className="stat-card">
                                            <div className="stat-icon-wrapper">
                                                <User size={20} />
                                            </div>
                                            <div className="stat-title">KEY SALES VISITS</div>
                                            <div className="stat-value">{stats.keyVisits}</div>
                                            <div className="stat-footer">{timeLabel}</div>
                                        </div> */}
                                                <div
                                                    className={`stat-card ${activeDashboardTab === 'resources' ? 'active-tab' : ''}`}
                                                    onClick={() => setActiveDashboardTab('resources')}
                                                    style={{ cursor: 'pointer' }}
                                                >
                                                    <div className="stat-icon-wrapper">
                                                        <FolderPlus size={20} />
                                                    </div>
                                                    <div className="stat-title">RESOURCES</div>
                                                    <div className="stat-desc">(Assignment & Updates)</div>
                                                    <div className="stat-value">{stats.resources}</div>
                                                    <div className="stat-footer">{timeLabel}</div>
                                                </div>
                                                <div
                                                    className={`stat-card ${activeDashboardTab === 'quickNotes' ? 'active-tab' : ''}`}
                                                    onClick={() => setActiveDashboardTab('quickNotes')}
                                                    style={{ cursor: 'pointer' }}
                                                >
                                                    <div className="stat-icon-wrapper">
                                                        <MessageSquare size={20} />
                                                    </div>
                                                    <div className="stat-title">QUICK NOTES</div>
                                                    <div className="stat-value">{stats.quickNotes}</div>
                                                    <div className="stat-footer">{timeLabel}</div>
                                                </div>
                                                <div
                                                    className={`stat-card ${activeDashboardTab === 'planner' ? 'active-tab' : ''}`}
                                                    onClick={() => setActiveDashboardTab('planner')}
                                                    style={{ cursor: 'pointer' }}
                                                >
                                                    <div className="stat-icon-wrapper">
                                                        <Calendar size={20} />
                                                    </div>
                                                    <div className="stat-title">CALENDAR</div>
                                                    <div className="stat-value">{todayScheduleCount}</div>
                                                    <div className="stat-footer">Schedule</div>
                                                </div>
                                                {/* <div className="stat-card">
                                            <div className="stat-icon-wrapper">
                                                <DollarSign size={20} />
                                            </div>
                                            <div className="stat-title">BIDS</div>
                                            <div className="stat-value">{stats.bids}</div>
                                            <div className="stat-footer">{timeLabel}</div>
                                        </div>
                                        <div className="stat-card">
                                            <div className="stat-icon-wrapper">
                                                <Clock size={20} />
                                            </div>
                                            <div className="stat-title">FOLLOW-UP</div>
                                            <div className="stat-value">{stats.followUp}</div>
                                            <div className="stat-footer">{timeLabel}</div>
                                        </div> */}
                                            </div>
                                        );
                                    })()}

                                    {/* Visits Table */}
                                    {/* Sales Visits Table */}
                                    {activeDashboardTab === 'planner' && (
                                        <div className="planner-dashboard-container">
                                            <SalesPlannerTab
                                                customers={customers}
                                                currentUserId={currentUserId}
                                                onSelectCustomer={handleSelectCustomer}
                                            />
                                        </div>
                                    )}

                                    {activeDashboardTab === 'visits' && (
                                        <div className="visits-table-section">
                                            <div className="section-header">
                                                <h2>Sales Visits</h2>
                                                <div className="table-controls">
                                                    <button className="export-btn" onClick={handleExportVisits}>
                                                        <Download size={18} /> Excel
                                                    </button>
                                                    <div className="table-search">
                                                        <input
                                                            type="text"
                                                            placeholder="Search visits..."
                                                            value={dashboardSearchTerm}
                                                            onChange={(e) => setDashboardSearchTerm(e.target.value)}
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="dashboard-table-wrapper">
                                                <table className="dashboard-table">
                                                    <thead>
                                                        <tr>
                                                            <th className="mobile-hide">Date</th>
                                                            <th>Customer</th>
                                                            <th className="mobile-hide">Visit Type</th>
                                                            <th className="mobile-hide">Notes</th>

                                                            <th>Action</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {(() => {
                                                            const visits = memoizedFilteredVisits;
                                                            if (visits.length === 0) {
                                                                return (
                                                                    <tr>
                                                                        <td colSpan="6" style={{ textAlign: 'center', padding: '2rem' }}>
                                                                            No data available in table
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            }

                                                            // Pagination logic
                                                            const indexOfLastVisit = currentVisitsPage * visitsPerPage;
                                                            const indexOfFirstVisit = indexOfLastVisit - visitsPerPage;
                                                            const currentVisits = visits.slice(indexOfFirstVisit, indexOfLastVisit);

                                                            return currentVisits.map((visit, index) => (
                                                                <tr key={visit._id || index}>
                                                                    <td className="mobile-hide">{formatDate(visit.date, { month: 'numeric', day: 'numeric', year: 'numeric' })}</td>
                                                                    <td>
                                                                        <span
                                                                            className="link"
                                                                            onClick={() => {
                                                                                const customer = customers.find(c => c._id === visit.customerId);
                                                                                if (customer) handleSelectCustomer(customer);
                                                                            }}
                                                                            title="Go to Customer Chat"
                                                                        >
                                                                            {visit.customerName}
                                                                        </span>
                                                                    </td>
                                                                    <td className="mobile-hide">{visit.purpose || '-'}</td>
                                                                    <td className="mobile-hide">{visit.notes ? (visit.notes.length > 50 ? visit.notes.substring(0, 50) + '...' : visit.notes) : '-'}</td>

                                                                    <td>
                                                                        <div style={{ display: 'flex', gap: '8px' }}>
                                                                            <button
                                                                                className="icon-btn-ghost"
                                                                                onClick={() => handleViewVisit(visit)}
                                                                                title="View Details"
                                                                                disabled={loadingVisitId === visit._id}
                                                                            >
                                                                                {loadingVisitId === visit._id ? <Loader size={16} className="animate-spin" /> : <Eye size={16} />}
                                                                            </button>
                                                                            <button
                                                                                className="icon-btn-ghost"
                                                                                onClick={() => handleEditVisit(visit)}
                                                                                title="Edit Visit"
                                                                                disabled={loadingVisitId === visit._id}
                                                                            >
                                                                                {loadingVisitId === visit._id ? <Loader size={16} className="animate-spin" /> : <Pencil size={16} />}
                                                                            </button>
                                                                            <button
                                                                                className="icon-btn-ghost delete-btn"
                                                                                onClick={() => handleDeleteVisit(visit._id, visit.customerId)}
                                                                                title="Delete Visit"
                                                                                style={{ color: '#ff4d4f' }}
                                                                            >
                                                                                <Trash2 size={16} />
                                                                            </button>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            ));
                                                        })()}
                                                    </tbody>
                                                </table>
                                            </div>

                                            {/* Pagination Controls */}
                                            {(() => {
                                                const visits = memoizedFilteredVisits;
                                                const totalPages = Math.ceil(visits.length / visitsPerPage);

                                                if (totalPages <= 1) return null;

                                                const handlePageChange = (pageNumber) => {
                                                    setCurrentVisitsPage(pageNumber);
                                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                                };

                                                return (
                                                    <div className="pagination-controls">
                                                        <button
                                                            className="pagination-btn"
                                                            onClick={() => handlePageChange(currentVisitsPage - 1)}
                                                            disabled={currentVisitsPage === 1}
                                                        >
                                                            ← Previous
                                                        </button>

                                                        <div className="pagination-pages">
                                                            {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
                                                                <button
                                                                    key={pageNum}
                                                                    className={`pagination-page ${currentVisitsPage === pageNum ? 'active' : ''}`}
                                                                    onClick={() => handlePageChange(pageNum)}
                                                                >
                                                                    {pageNum}
                                                                </button>
                                                            ))}
                                                        </div>

                                                        <button
                                                            className="pagination-btn"
                                                            onClick={() => handlePageChange(currentVisitsPage + 1)}
                                                            disabled={currentVisitsPage === totalPages}
                                                        >
                                                            Next →
                                                        </button>

                                                        <div className="pagination-info">
                                                            Showing {((currentVisitsPage - 1) * visitsPerPage) + 1}-{Math.min(currentVisitsPage * visitsPerPage, visits.length)} of {visits.length} visits
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}

                                    {/* Quick Notes Table */}
                                    {activeDashboardTab === 'quickNotes' && (
                                        <div className="visits-table-section">
                                            <div className="section-header">
                                                <h2>Quick Notes</h2>
                                                <div className="table-controls">
                                                    <button className="export-btn" onClick={() => {
                                                        const qNotes = memoizedFilteredVisits.filter(v => v && v.purpose?.toLowerCase().includes('quick note'));
                                                        handleExportVisits(qNotes);
                                                    }}>
                                                        <Download size={18} /> Excel
                                                    </button>
                                                    <div className="table-search">
                                                        <input
                                                            type="text"
                                                            placeholder="Search quick notes..."
                                                            value={dashboardSearchTerm}
                                                            onChange={(e) => setDashboardSearchTerm(e.target.value)}
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="dashboard-table-wrapper">
                                                <table className="dashboard-table">
                                                    <thead>
                                                        <tr>
                                                            <th className="mobile-hide">Date</th>
                                                            <th>Customer</th>
                                                            <th className="mobile-hide">Visit Type</th>
                                                            <th className="mobile-hide">Notes</th>
                                                            <th>Action</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {(() => {
                                                            const visits = memoizedFilteredVisits.filter(v => v && v.purpose?.toLowerCase().includes('quick note'));
                                                            if (visits.length === 0) {
                                                                return (
                                                                    <tr>
                                                                        <td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>
                                                                            No quick notes available
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            }

                                                            // Pagination logic
                                                            const indexOfLastVisit = currentVisitsPage * visitsPerPage;
                                                            const indexOfFirstVisit = indexOfLastVisit - visitsPerPage;
                                                            const currentVisits = visits.slice(indexOfFirstVisit, indexOfLastVisit);

                                                            return currentVisits.map((visit, index) => (
                                                                <tr key={visit._id || index}>
                                                                    <td className="mobile-hide">{formatDate(visit.date, { month: 'numeric', day: 'numeric', year: 'numeric' })}</td>
                                                                    <td>
                                                                        <span
                                                                            className="link"
                                                                            onClick={() => {
                                                                                const customer = customers.find(c => c._id === visit.customerId);
                                                                                if (customer) handleSelectCustomer(customer);
                                                                            }}
                                                                            title="Go to Customer Chat"
                                                                        >
                                                                            {visit.customerName}
                                                                        </span>
                                                                    </td>
                                                                    <td className="mobile-hide">{visit.purpose || 'Quick Note'}</td>
                                                                    <td className="mobile-hide">{visit.notes ? (visit.notes.length > 50 ? visit.notes.substring(0, 50) + '...' : visit.notes) : '-'}</td>
                                                                    <td>
                                                                        <div style={{ display: 'flex', gap: '8px' }}>
                                                                            <button
                                                                                className="icon-btn-ghost"
                                                                                onClick={() => handleViewVisit(visit)}
                                                                                title="View Details"
                                                                                disabled={loadingVisitId === visit._id}
                                                                            >
                                                                                {loadingVisitId === visit._id ? <Loader size={16} className="animate-spin" /> : <Eye size={16} />}
                                                                            </button>
                                                                            <button
                                                                                className="icon-btn-ghost"
                                                                                onClick={() => handleEditVisit(visit)}
                                                                                title="Edit Visit"
                                                                                disabled={loadingVisitId === visit._id}
                                                                            >
                                                                                {loadingVisitId === visit._id ? <Loader size={16} className="animate-spin" /> : <Pencil size={16} />}
                                                                            </button>
                                                                            <button
                                                                                className="icon-btn-ghost delete-btn"
                                                                                onClick={() => handleDeleteVisit(visit._id, visit.customerId)}
                                                                                title="Delete Visit"
                                                                                style={{ color: '#ff4d4f' }}
                                                                            >
                                                                                <Trash2 size={16} />
                                                                            </button>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            ));
                                                        })()}
                                                    </tbody>
                                                </table>
                                            </div>

                                            {/* Pagination Controls */}
                                            {(() => {
                                                const visits = memoizedFilteredVisits.filter(v => v && v.purpose?.toLowerCase().includes('quick note'));
                                                const totalPages = Math.ceil(visits.length / visitsPerPage);

                                                if (totalPages <= 1) return null;

                                                const handlePageChange = (pageNumber) => {
                                                    setCurrentVisitsPage(pageNumber);
                                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                                };

                                                return (
                                                    <div className="pagination-controls">
                                                        <button
                                                            className="pagination-btn"
                                                            onClick={() => handlePageChange(currentVisitsPage - 1)}
                                                            disabled={currentVisitsPage === 1}
                                                        >
                                                            ← Previous
                                                        </button>

                                                        <div className="pagination-pages">
                                                            {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
                                                                <button
                                                                    key={pageNum}
                                                                    className={`pagination-page ${currentVisitsPage === pageNum ? 'active' : ''}`}
                                                                    onClick={() => handlePageChange(pageNum)}
                                                                >
                                                                    {pageNum}
                                                                </button>
                                                            ))}
                                                        </div>

                                                        <button
                                                            className="pagination-btn"
                                                            onClick={() => handlePageChange(currentVisitsPage + 1)}
                                                            disabled={currentVisitsPage === totalPages}
                                                        >
                                                            Next →
                                                        </button>

                                                        <div className="pagination-info">
                                                            Showing {((currentVisitsPage - 1) * visitsPerPage) + 1}-{Math.min(currentVisitsPage * visitsPerPage, visits.length)} of {visits.length} notes
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}

                                    {/* Resources Table */}
                                    {activeDashboardTab === 'resources' && (
                                        <div className="visits-table-section">
                                            <div className="section-header">
                                                <h2>Resources</h2>
                                                {activeResourceSubTab === 'client' && (
                                                    <div className="table-controls">
                                                        <button className="export-btn" onClick={handleExportResources}>
                                                            <Download size={18} /> Excel
                                                        </button>
                                                        <div className="table-search">
                                                            <input
                                                                type="text"
                                                                placeholder="Search resources..."
                                                                value={dashboardSearchTerm}
                                                                onChange={(e) => setDashboardSearchTerm(e.target.value)}
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                                {activeResourceSubTab === 'team' && (
                                                    <div className="team-resources-controls">
                                                        <div className="resource-breadcrumbs">
                                                            <span
                                                                className="breadcrumb-item"
                                                                onClick={() => {
                                                                    if (folderPath.length > 0) {
                                                                        // Navigate to root
                                                                        setCurrentFolderId(null);
                                                                        setFolderPath([]);
                                                                        setDashboardSearchTerm('');
                                                                    }
                                                                }}
                                                            >
                                                                Home
                                                            </span>
                                                            {folderPath.map((folder, index) => (
                                                                <React.Fragment key={folder.id}>
                                                                    <span className="breadcrumb-separator">/</span>
                                                                    <span
                                                                        className={`breadcrumb-item ${index === folderPath.length - 1 ? 'current' : ''}`}
                                                                        onClick={() => handleBreadcrumbClick(index)}
                                                                    >
                                                                        {folder.name}
                                                                    </span>
                                                                </React.Fragment>
                                                            ))}
                                                        </div>
                                                        <div className="team-resources-actions">
                                                            <button className="icon-action-btn secondary" onClick={() => setShowAddFolderModal(true)}>
                                                                <FolderPlus size={16} /> <span className="mobile-hide-text">Add Folder</span>
                                                            </button>
                                                            <button className="icon-action-btn primary" onClick={() => setShowDashboardUploadModal(true)}>
                                                                <Upload size={16} /> <span className="mobile-hide-text">Upload</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="dashboard-sub-tabs">
                                                <button
                                                    className={`sub-tab-btn ${activeResourceSubTab === 'client' ? 'active' : ''}`}
                                                    onClick={() => setActiveResourceSubTab('client')}
                                                >
                                                    Client Updates
                                                </button>
                                                <button
                                                    className={`sub-tab-btn ${activeResourceSubTab === 'team' ? 'active' : ''}`}
                                                    onClick={() => setActiveResourceSubTab('team')}
                                                >
                                                    Team Files
                                                </button>
                                            </div>

                                            {activeResourceSubTab === 'client' && (
                                                <>


                                                    <div className="dashboard-table-wrapper">
                                                        <table className="dashboard-table">
                                                            <thead>
                                                                <tr>
                                                                    <th className="mobile-hide">Date</th>
                                                                    <th>Customer</th>
                                                                    <th>Type</th>
                                                                    <th className="mobile-hide">Description</th>
                                                                    <th>Action</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {(() => {
                                                                    const resources = memoizedFilteredResources;
                                                                    if (resources.length === 0) {
                                                                        return (
                                                                            <tr>
                                                                                <td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>
                                                                                    No resources found
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    }
                                                                    return resources.map((resource, index) => (
                                                                        <tr key={resource._id || index}>
                                                                            <td className="mobile-hide">{formatDate(resource.date || resource.createdAt, { month: 'numeric', day: 'numeric', year: 'numeric' })}</td>
                                                                            <td
                                                                                style={{ cursor: 'pointer', color: '#E5C04A', fontWeight: '500' }}
                                                                                onClick={() => {
                                                                                    if (resource.customerId) {
                                                                                        const customer = customers.find(c => c._id === resource.customerId);
                                                                                        if (customer) {
                                                                                            handleSelectCustomer(customer);
                                                                                            setActiveTab('resources');
                                                                                            setShowDashboard(false);
                                                                                        }
                                                                                    }
                                                                                }}
                                                                            >
                                                                                {resource.customerName}
                                                                            </td>
                                                                            <td>{resource.resourceType || '-'}</td>
                                                                            <td className="mobile-hide">{resource.description || resource.notes || '-'}</td>
                                                                            <td>
                                                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                                                    <button
                                                                                        className="icon-btn-ghost"
                                                                                        title="View Details"
                                                                                        onClick={() => handleViewResource(resource)}
                                                                                        disabled={loadingResourceId === resource._id}
                                                                                    >
                                                                                        {loadingResourceId === resource._id ? <Loader size={16} className="animate-spin" /> : <Eye size={16} />}
                                                                                    </button>
                                                                                    <button
                                                                                        className="icon-btn-ghost"
                                                                                        title="Edit Resource"
                                                                                        onClick={() => handleEditResource(resource)}
                                                                                        disabled={loadingResourceId === resource._id}
                                                                                    >
                                                                                        {loadingResourceId === resource._id ? <Loader size={16} className="animate-spin" /> : <Pencil size={16} />}
                                                                                    </button>
                                                                                    <button
                                                                                        className="icon-btn-ghost delete-btn"
                                                                                        title="Delete Resource"
                                                                                        onClick={() => handleDeleteResource(resource._id, resource.customerId)}
                                                                                        style={{ color: '#ff4d4f' }}
                                                                                    >
                                                                                        <Trash2 size={16} />
                                                                                    </button>
                                                                                    {(Array.isArray(resource.image || resource.content) ? (resource.image || resource.content) : ((resource.image || resource.content) ? [resource.image || resource.content] : [])).length > 0 && ( /* Check if attachments exist */
                                                                                        <button
                                                                                            className="icon-btn-ghost"
                                                                                            title="View Attachments"
                                                                                            onClick={() => {
                                                                                                const img = (Array.isArray(resource.image || resource.content) ? (resource.image || resource.content) : [resource.image || resource.content])[0];
                                                                                                if (img) setFullScreenImage(img);
                                                                                            }}
                                                                                            disabled={loadingResourceId === resource._id}
                                                                                        >
                                                                                            {loadingResourceId === resource._id ? <Loader size={16} className="animate-spin" /> : <Paperclip size={16} />}
                                                                                        </button>
                                                                                    )}
                                                                                    {resource.url ? (
                                                                                        <a href={resource.url} target="_blank" rel="noopener noreferrer" className="icon-btn-ghost" title="Open Link">
                                                                                            <Link size={16} />
                                                                                        </a>
                                                                                    ) : (resource.image) ? (
                                                                                        <button
                                                                                            className="icon-btn-ghost"
                                                                                            title="Download"
                                                                                            onClick={() => {
                                                                                                const img = (Array.isArray(resource.image) ? resource.image : [resource.image])[0];
                                                                                                if (img) handleDashboardDownload({ content: img, name: `Resource-${resource.date}.jpg`, type: 'file' });
                                                                                            }}
                                                                                        >
                                                                                            <Download size={16} />
                                                                                        </button>
                                                                                    ) : null}
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    ));
                                                                })()}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </>
                                            )}

                                            {activeResourceSubTab === 'team' && (
                                                <div className="team-resources-content">


                                                    <div className="dashboard-resources-grid">
                                                        {/* Back Folder */}
                                                        {folderPath.length > 0 && (
                                                            <div
                                                                className="dashboard-resource-card folder"
                                                                onClick={() => handleBreadcrumbClick(folderPath.length - 2)}
                                                            >
                                                                <div className="resource-icon">
                                                                    <Folder size={40} />
                                                                </div>
                                                                <div className="resource-name">..</div>
                                                            </div>
                                                        )}

                                                        {/* Resources */}
                                                        {salesResources.filter(r => !dashboardSearchTerm || r.name.toLowerCase().includes(dashboardSearchTerm.toLowerCase())).map(resource => (
                                                            <div
                                                                key={resource._id}
                                                                className={`dashboard-resource-card ${resource.type}`}
                                                                onClick={() => resource.type === 'folder' ? handleFolderClick(resource) : handleFileClick(resource)}
                                                            >
                                                                <div className="resource-icon">
                                                                    {resource.type === 'folder' ? (
                                                                        <Folder size={40} />
                                                                    ) : (
                                                                        <FileText size={40} />
                                                                    )}
                                                                </div>
                                                                <div className="resource-name" title={resource.name}>
                                                                    {resource.name}
                                                                </div>
                                                            </div>
                                                        ))}

                                                        {salesResources.length === 0 && (
                                                            <div style={{ padding: '2rem', gridColumn: '1 / -1', textAlign: 'center', color: '#6B7280' }}>
                                                                No files or folders found
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )
                    }
                </ErrorBoundary>

                {/* Dashboard Resource Preview Modal */}
                {
                    previewDashboardResource && (
                        <div className="modal-overlay" onClick={() => setPreviewDashboardResource(null)}>
                            <div className="modal-content preview-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '800px', width: '90%' }}>
                                <div className="modal-header">
                                    <h2>{previewDashboardResource.name}</h2>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <button
                                            className="icon-btn"
                                            title="Download"
                                            onClick={() => handleDashboardDownload(previewDashboardResource)}
                                        >
                                            <Download size={20} />
                                        </button>
                                        <button className="close-btn" onClick={() => setPreviewDashboardResource(null)}>
                                            <X size={20} />
                                        </button>
                                    </div>
                                </div>
                                <div className="modal-body" style={{ padding: '0', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px', background: '#f9fafb' }}>
                                    {previewDashboardResource.content.startsWith('data:image') || (!previewDashboardResource.content.startsWith('data:') && (previewDashboardResource.contentType?.startsWith('image/') || previewDashboardResource.name.match(/\.(jpg|jpeg|png|gif|webp)$/i))) ? (
                                        <img
                                            src={previewDashboardResource.content.startsWith('data:') ? previewDashboardResource.content : `${API_URL}${previewDashboardResource.content}`}
                                            alt={previewDashboardResource.name}
                                            style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
                                        />
                                    ) : previewDashboardResource.content.startsWith('data:application/pdf') || (!previewDashboardResource.content.startsWith('data:') && (previewDashboardResource.contentType === 'application/pdf' || previewDashboardResource.name.toLowerCase().endsWith('.pdf'))) ? (
                                        <iframe
                                            src={previewDashboardResource.content.startsWith('data:') ? previewDashboardResource.content : `${API_URL}${previewDashboardResource.content}`}
                                            style={{ width: '100%', height: '70vh', border: 'none' }}
                                            title={previewDashboardResource.name}
                                        />
                                    ) : (
                                        <div style={{ textAlign: 'center', padding: '2rem' }}>
                                            <p>Preview not available for this file type.</p>
                                            <button
                                                className="btn-primary"
                                                onClick={() => handleDashboardDownload(previewDashboardResource)}
                                                style={{ marginTop: '1rem' }}
                                            >
                                                Download File
                                            </button>
                                        </div>
                                    )}
                                </div>

                            </div>
                        </div>
                    )
                }

            </div >

            {/* Contact Modal */}
            {
                showContactModal && (
                    <div className="modal-overlay" onClick={() => setShowContactModal(false)}>
                        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>{editingContact ? 'Edit Contact' : 'Add Contact'}</h2>
                                <button className="close-btn" onClick={() => setShowContactModal(false)}>
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label>Name *</label>
                                    <input
                                        type="text"
                                        value={contactForm.name}
                                        onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                                        placeholder="Contact name"
                                    />
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Phone</label>
                                        <input
                                            type="tel"
                                            value={contactForm.phone}
                                            onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                                            placeholder="Phone number"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Email</label>
                                        <input
                                            type="email"
                                            value={contactForm.email}
                                            onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                                            placeholder="Email address"
                                        />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label>Role</label>
                                    <input
                                        type="text"
                                        value={contactForm.role}
                                        onChange={(e) => setContactForm({ ...contactForm, role: e.target.value })}
                                        placeholder="Job title or role"
                                    />
                                </div>
                                <div className="form-group checkbox-group">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={contactForm.isPrimary}
                                            onChange={(e) => setContactForm({ ...contactForm, isPrimary: e.target.checked })}
                                        />
                                        <span>Primary Contact</span>
                                    </label>
                                </div>
                                <div className="form-group">
                                    <label>Notes</label>
                                    <textarea
                                        value={contactForm.notes}
                                        onChange={(e) => setContactForm({ ...contactForm, notes: e.target.value })}
                                        placeholder="Additional notes"
                                        rows="3"
                                    />
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button className="btn-secondary" onClick={() => setShowContactModal(false)} disabled={isSaving}>
                                    Cancel
                                </button>
                                <button className="btn-primary" onClick={handleSaveContact} disabled={isSaving}>
                                    {isSaving ? 'Saving...' : 'Save Contact'}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Visit Modal */}
            {/* Visit Modal (Edit/Add) */}
            {
                showVisitModal && !isViewingVisit && (
                    <div className="modal-overlay" onClick={handleCloseVisitModal}>
                        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>{editingVisit ? 'Edit Visit' : 'Add Visit'}</h2>
                                <button className="close-btn" onClick={handleCloseVisitModal}>
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label>Date <span style={{ color: 'red' }}>*</span></label>
                                    <CustomDatePicker
                                        value={visitForm.date}
                                        onChange={(value) => setVisitForm({ ...visitForm, date: value })}
                                        required
                                    />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                                    <div className="form-group">
                                        <label>Customer <span style={{ color: 'red' }}>*</span></label>
                                        <SearchableSelect
                                            options={customerOptions}
                                            value={visitForm.customerId}
                                            onChange={(value) => setVisitForm({ ...visitForm, customerId: value })}
                                            placeholder="Select a Customer..."
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Visit Type <span style={{ color: 'red' }}>*</span></label>
                                        <SearchableSelect
                                            options={[
                                                'Quick Note',
                                                'Scheduled in Person Sales Meeting',
                                                'Unscheduled in Person Sales Call',
                                                'Resource Placement',
                                                'Resource Update',
                                                'Formal Presentation',
                                                'Important Remote Meeting/Call',
                                                'In Office Administration Day',
                                                'Personal Time Off'
                                            ].map(type => ({ value: type, label: type }))}
                                            value={visitForm.purpose}
                                            onChange={(value) => setVisitForm({ ...visitForm, purpose: value })}
                                            placeholder="Please Select Visit Type"
                                        />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label>Notes</label>
                                    <textarea
                                        value={visitForm.notes}
                                        onChange={(e) => setVisitForm({ ...visitForm, notes: e.target.value })}
                                        placeholder="Additional notes"
                                        rows="4"
                                    />
                                </div>
                                {!visitForm.purpose?.toLowerCase().includes('quick note') && (
                                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                                        <div className="form-group">
                                            <label>Outcome</label>
                                            <textarea
                                                value={visitForm.outcome}
                                                onChange={(e) => setVisitForm({ ...visitForm, outcome: e.target.value })}
                                                placeholder="Visit outcome"
                                                rows="3"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Follow Up</label>
                                            <textarea
                                                value={visitForm.followUp}
                                                onChange={(e) => setVisitForm({ ...visitForm, followUp: e.target.value })}
                                                placeholder="Followup Notes"
                                                rows="3"
                                            />
                                        </div>
                                    </div>
                                )}
                                <div className="form-group">
                                    <label>Attachments</label>
                                    <div className="image-upload-container">
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '8px', marginBottom: '8px' }}>
                                            {visitForm.image && (Array.isArray(visitForm.image) ? visitForm.image : [visitForm.image]).map((img, idx) => (
                                                <div key={idx} className="image-preview-wrapper" style={{ width: '100%', height: '80px', position: 'relative' }}>
                                                    {img.startsWith('data:application/pdf') ? (
                                                        <div className="pdf-preview" style={{
                                                            width: '100%',
                                                            height: '100%',
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            background: '#f5f5f5',
                                                            borderRadius: '4px',
                                                            border: '1px solid #ddd'
                                                        }}>
                                                            <FileText size={32} color="#E5C04A" />
                                                            <span style={{ fontSize: '10px', marginTop: '4px', color: '#666' }}>PDF</span>
                                                        </div>
                                                    ) : (
                                                        <img src={img} alt="Preview" className="image-preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    )}
                                                    <button type="button" className="remove-image-btn" onClick={() => handleRemoveVisitImage(idx)} style={{ padding: '2px', position: 'absolute', top: '-6px', right: '-6px', background: 'red', color: 'white', borderRadius: '50%', border: 'none', cursor: 'pointer', zIndex: 10 }}>
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="file-input-wrapper-simple">
                                            <input
                                                type="file"
                                                id="visit-image-upload"
                                                accept="image/*,application/pdf"
                                                multiple
                                                onChange={handleVisitImageUpload}
                                                className="file-input"
                                            />
                                            <label htmlFor="visit-image-upload" className="file-input-label">
                                                Add Files
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                {editingVisit && (
                                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                                        <div className="form-group">
                                            <label>Manager Comment</label>
                                            <input
                                                type="text"
                                                value={visitForm.managerComment}
                                                onChange={(e) => setVisitForm({ ...visitForm, managerComment: e.target.value })}
                                                placeholder="Comment from Manager"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Headquarters Comment</label>
                                            <input
                                                type="text"
                                                value={visitForm.headquartersComment}
                                                onChange={(e) => setVisitForm({ ...visitForm, headquartersComment: e.target.value })}
                                                placeholder="Comment from HQ"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button className="btn-secondary" onClick={handleCloseVisitModal} disabled={isSaving}>
                                    Cancel
                                </button>
                                <button className="btn-primary" onClick={handleSaveVisit} disabled={isSaving}>
                                    {isSaving ? 'Saving...' : (editingVisit ? 'Save Changes' : 'Add Visit')}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Visit Modal (View Only) */}
            {
                showVisitModal && isViewingVisit && (
                    <div className="modal-overlay" onClick={handleCloseVisitModal}>
                        {console.log("Rendering View Visit Modal - V2")}
                        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>Visit Details</h2>
                                <button className="close-btn" onClick={handleCloseVisitModal}>
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="modal-body">
                                <div className="visit-details-grid">
                                    <div className="visit-detail-item">
                                        <div className="visit-detail-label">Date</div>
                                        <div className="visit-detail-value">{formatDate(visitForm.date)}</div>
                                    </div>
                                    <div className="visit-detail-item">
                                        <div className="visit-detail-label">Customer</div>
                                        <div className="visit-detail-value">
                                            {(() => {
                                                if (selectedCustomer) return selectedCustomer.company || selectedCustomer.contactName;
                                                const c = customers.find(c => c._id === (visitForm.customerId || editingVisit?.customerId));
                                                return c ? (c.company || c.contactName) : (visitForm?.customerContactName || visitForm?.customerName || editingVisit?.customerName || '-');
                                            })()}
                                        </div>
                                    </div>
                                    <div className="visit-detail-item">
                                        <div className="visit-detail-label">Visit Type</div>
                                        <div className="visit-detail-value">{visitForm.purpose || '-'}</div>
                                    </div>
                                    <div className="visit-detail-item full-width">
                                        <div className="visit-detail-label">Notes</div>
                                        <div className="visit-detail-value" style={{ border: 'none', background: 'none', padding: 0, color: 'var(--text-primary)' }}>
                                            {visitForm.notes || 'No notes available.'}
                                        </div>
                                    </div>
                                    {!visitForm.purpose?.toLowerCase().includes('quick note') && (
                                        <>
                                            <div className="visit-detail-item">
                                                <div className="visit-detail-label">Outcome</div>
                                                <div className="visit-detail-value">{visitForm.outcome || '-'}</div>
                                            </div>
                                            <div className="visit-detail-item">
                                                <div className="visit-detail-label">Follow Up</div>
                                                <div className="visit-detail-value">{visitForm.followUp || visitForm.nextAction || '-'}</div>
                                            </div>
                                        </>
                                    )}
                                    <div className="visit-detail-item full-width">
                                        <div className="visit-detail-label">Attachments</div>
                                        {console.log('[DEBUG MODAL] visitForm.image:', visitForm.image)}
                                        {(visitForm.image && (Array.isArray(visitForm.image) ? visitForm.image : [visitForm.image]).length > 0) ? (
                                            <div className="visit-attachments-grid" style={{ marginTop: '0.5rem' }}>
                                                {(Array.isArray(visitForm.image) ? visitForm.image : [visitForm.image]).map((img, idx) => (
                                                    <div key={idx} className="attachment-preview-card">
                                                        {img.startsWith('data:application/pdf') ? (
                                                            <div
                                                                className="attachment-pdf"
                                                                onClick={() => handleDashboardDownload({ content: img, name: `Visit-Doc-${idx}.pdf`, type: 'file' })}
                                                            >
                                                                <FileText size={32} />
                                                                <span style={{ fontSize: '10px', marginTop: '4px', fontWeight: 600 }}>PDF</span>
                                                            </div>
                                                        ) : (
                                                            <img
                                                                src={img}
                                                                alt="Preview"
                                                                className="attachment-img"
                                                                onClick={() => setFullScreenImage(img)}
                                                                style={{ borderRadius: '8px', cursor: 'pointer' }}
                                                            />
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="visit-detail-value">-</div>
                                        )}
                                    </div>
                                    <div className="visit-detail-item">
                                        <div className="visit-detail-label">Manager Comment</div>
                                        <div className="visit-detail-value">{visitForm.managerComment || '-'}</div>
                                    </div>
                                    <div className="visit-detail-item">
                                        <div className="visit-detail-label">Headquarters Comment</div>
                                        <div className="visit-detail-value">{visitForm.headquartersComment || '-'}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Resource Modal */}
            {
                showResourceModal && (
                    <div className="modal-overlay" onClick={() => setShowResourceModal(false)}>
                        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>{editingResource ? (isViewingResource ? 'Resource Details' : 'Edit Resource') : 'Add Resource'}</h2>
                                <button className="close-btn" onClick={() => setShowResourceModal(false)}>
                                    <X size={20} />
                                </button>
                            </div>

                            {isViewingResource ? (
                                /* View Mode Layout */
                                <div className={`modal-body view-mode ${resourceForm.image ? 'has-image' : ''}`}>
                                    {resourceForm.image && (Array.isArray(resourceForm.image) ? resourceForm.image : [resourceForm.image]).length > 0 && (
                                        <div className="view-image-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '10px' }}>
                                            {(Array.isArray(resourceForm.image) ? resourceForm.image : [resourceForm.image]).map((img, idx) => (
                                                <div key={idx} style={{ position: 'relative', aspectRatio: '1' }}>
                                                    <img
                                                        src={(() => {
                                                            if (!img) return '';
                                                            if (img.startsWith('data:') || img.startsWith('http')) return img;
                                                            if (img.includes('uploads/')) {
                                                                return `${API_URL}${img.startsWith('/') ? '' : '/'}${img}`;
                                                            }
                                                            return `${API_URL}/uploads/resources/${img}`;
                                                        })()}
                                                        alt={`Resource ${idx + 1}`}
                                                        onClick={() => setFullScreenImage(img)}
                                                        className="view-resource-image"
                                                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px', cursor: 'pointer' }}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <div className="view-content-wrapper">
                                        <div className="view-details-grid">
                                            <div className="view-detail-item">
                                                <label>Client</label>
                                                <p>{resourceForm.customer || '-'}</p>
                                            </div>
                                            <div className="view-detail-item">
                                                <label>Type</label>
                                                <p>{resourceForm.resourceType || '-'}</p>
                                            </div>
                                            <div className="view-detail-item">
                                                <label>Date</label>
                                                <p>{formatDate(resourceForm.date)}</p>
                                            </div>
                                            <div className="view-detail-item">
                                                <label>Status</label>
                                                <span className={`status-badge ${resourceForm.status?.toLowerCase()}`}>
                                                    {resourceForm.status || 'Active'}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="view-section">
                                            <label>Description</label>
                                            <p className="view-text">{resourceForm.description || 'No description provided.'}</p>
                                        </div>

                                        {resourceForm.notes && (
                                            <div className="view-section">
                                                <label>Notes</label>
                                                <p className="view-text">{resourceForm.notes}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                /* Edit/Add Mode Layout */
                                <div className="modal-body">

                                    <div className="form-group">
                                        <label>Client *</label>
                                        <SearchableSelect
                                            options={customerOptions}
                                            value={resourceForm.customerId}
                                            onChange={(value) => {
                                                const selectedC = customers.find(c => c._id === value);
                                                setResourceForm({
                                                    ...resourceForm,
                                                    customerId: value,
                                                    customer: selectedC ? (selectedC.company || selectedC.contactName) : ''
                                                });
                                            }}
                                            placeholder="Select a Client..."
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Resource Type *</label>
                                        <SearchableSelect
                                            options={resourceTypes.map(type => ({ value: type, label: type }))}
                                            value={resourceForm.resourceType}
                                            onChange={(value) => setResourceForm({ ...resourceForm, resourceType: value, title: value })}
                                            placeholder="Please Select Resource Type"
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label>Date *</label>
                                        <CustomDatePicker
                                            value={resourceForm.date}
                                            onChange={(value) => setResourceForm({ ...resourceForm, date: value })}
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Status</label>
                                        <SearchableSelect
                                            options={[
                                                { value: 'Active', label: 'Active' },
                                                { value: 'Inactive', label: 'Inactive' },
                                                { value: 'Archived', label: 'Archived' }
                                            ]}
                                            value={resourceForm.status}
                                            onChange={(value) => setResourceForm({ ...resourceForm, status: value })}
                                            placeholder="Select Status"
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label>Description</label>
                                        <input
                                            type="text"
                                            value={resourceForm.description}
                                            onChange={(e) => setResourceForm({ ...resourceForm, description: e.target.value })}
                                            placeholder="Description"
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label>Notes</label>
                                        <textarea
                                            value={resourceForm.notes}
                                            onChange={(e) => setResourceForm({ ...resourceForm, notes: e.target.value })}
                                            placeholder="Additional notes"
                                            rows="3"
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label>Attachments</label>
                                        <div className="image-upload-container">
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '8px', marginBottom: '8px' }}>
                                                {resourceForm.image && (Array.isArray(resourceForm.image) ? resourceForm.image : [resourceForm.image]).map((img, idx) => (
                                                    <div key={idx} className="image-preview-wrapper" style={{ width: '100%', height: '80px', position: 'relative' }}>
                                                        {img.startsWith('data:application/pdf') ? (
                                                            <div className="pdf-preview" style={{
                                                                width: '100%',
                                                                height: '100%',
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                background: '#f5f5f5',
                                                                borderRadius: '4px',
                                                                border: '1px solid #ddd'
                                                            }}>
                                                                <FileText size={32} color="#E5C04A" />
                                                                <span style={{ fontSize: '10px', marginTop: '4px', color: '#666' }}>PDF</span>
                                                            </div>
                                                        ) : (
                                                            <img
                                                                src={(() => {
                                                                    if (!img) return '';
                                                                    if (img.startsWith('data:') || img.startsWith('http')) return img;
                                                                    // If path already contains uploads (e.g. /uploads/resources/foo.jpg or uploads/resources/foo.jpg)
                                                                    if (img.includes('uploads/')) {
                                                                        return `${API_URL}${img.startsWith('/') ? '' : '/'}${img}`;
                                                                    }
                                                                    // Otherwise assume it's a filename in the resources folder
                                                                    return `${API_URL}/uploads/resources/${img}`;
                                                                })()}
                                                                alt="Preview"
                                                                className="image-preview"
                                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                            />
                                                        )}
                                                        <button type="button" className="remove-image-btn" onClick={() => handleRemoveResourceImage(idx)} style={{ padding: '2px', position: 'absolute', top: '-6px', right: '-6px', background: 'red', color: 'white', borderRadius: '50%', border: 'none', cursor: 'pointer', zIndex: 10 }}>
                                                            <X size={12} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="file-input-wrapper-simple">
                                                <input
                                                    type="file"
                                                    id="resource-image-upload"
                                                    accept="image/*,application/pdf"
                                                    multiple
                                                    onChange={handleImageUpload}
                                                    className="file-input"
                                                />
                                                <label htmlFor="resource-image-upload" className="file-input-label">
                                                    {resourceForm.image && resourceForm.image.length > 0 ? 'Add More Files' : 'Choose Files'}
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="modal-footer">
                                {isViewingResource ? (
                                    <button className="btn-secondary" onClick={handleCloseResourceModal}>Close</button>
                                ) : (
                                    <>
                                        <button className="btn-secondary" onClick={handleCloseResourceModal} disabled={isSaving}>
                                            Cancel
                                        </button>
                                        <button className="btn-primary" onClick={handleSaveResource} disabled={isSaving}>
                                            {isSaving ? 'Saving...' : (editingResource ? 'Save Changes' : 'Add Resource')}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }

            {
                fullScreenImage && (
                    <div className="fullscreen-image-overlay" onClick={() => { setFullScreenImage(null); setFullScreenGallery([]); }}>
                        <div className="fullscreen-image-container" onClick={(e) => e.stopPropagation()} style={{ width: fullScreenImage.startsWith('data:application/pdf') ? '80%' : 'auto', height: fullScreenImage.startsWith('data:application/pdf') ? '90%' : 'auto', maxWidth: '90%', maxHeight: '90%' }}>
                            <button className="fullscreen-close-btn" onClick={() => { setFullScreenImage(null); setFullScreenGallery([]); }}>
                                <X size={32} />
                            </button>

                            {fullScreenGallery.length > 1 && (
                                <>
                                    <button className="gallery-nav-btn prev" onClick={(e) => { e.stopPropagation(); handlePrevImage(); }}>
                                        <ChevronLeft size={48} />
                                    </button>
                                    <button className="gallery-nav-btn next" onClick={(e) => { e.stopPropagation(); handleNextImage(); }}>
                                        <ChevronRight size={48} />
                                    </button>
                                    <div className="gallery-index-indicator">
                                        {fullScreenIndex + 1} / {fullScreenGallery.length}
                                    </div>
                                </>
                            )}

                            {fullScreenImage.startsWith('data:application/pdf') ? (
                                <iframe src={fullScreenImage} style={{ width: '100%', height: '100%', border: 'none', background: 'white' }} title="PDF Preview"></iframe>
                            ) : (
                                <img src={fullScreenImage} alt="Full Screen" />
                            )}
                        </div>
                    </div>
                )
            }


            {/* Dashboard Upload Modal */}
            {
                showDashboardUploadModal && (
                    <div className="modal-overlay" onClick={() => setShowDashboardUploadModal(false)}>
                        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>Upload Dashboard Resource</h2>
                                <button className="close-btn" onClick={() => setShowDashboardUploadModal(false)}>
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label>Resource Name</label>
                                    <input
                                        type="text"
                                        value={dashboardUploadForm.name}
                                        onChange={(e) => setDashboardUploadForm({ ...dashboardUploadForm, name: e.target.value })}
                                        placeholder="Enter resource name"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Type</label>
                                    <select
                                        value={dashboardUploadForm.type}
                                        onChange={(e) => setDashboardUploadForm({ ...dashboardUploadForm, type: e.target.value })}
                                        className="form-select"
                                    >
                                        <option value="file">File</option>
                                        <option value="link">Link</option>
                                    </select>
                                </div>
                                {dashboardUploadForm.type === 'link' ? (
                                    <div className="form-group">
                                        <label>URL</label>
                                        <input
                                            type="url"
                                            value={dashboardUploadForm.url || ''}
                                            onChange={(e) => setDashboardUploadForm({ ...dashboardUploadForm, url: e.target.value })}
                                            placeholder="https://example.com"
                                        />
                                    </div>
                                ) : (
                                    <div className="form-group">
                                        <label>File</label>
                                        <input
                                            type="file"
                                            onChange={(e) => setDashboardUploadForm({ ...dashboardUploadForm, file: e.target.files[0] })}
                                        />
                                    </div>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button className="btn-secondary" onClick={() => setShowDashboardUploadModal(false)}>Cancel</button>
                                <button className="btn-primary" onClick={handleDashboardUpload}>Upload</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Add Folder Modal */}
            {
                showAddFolderModal && (
                    <div className="modal-overlay" onClick={() => setShowAddFolderModal(false)}>
                        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>Create New Folder</h2>
                                <button className="close-btn" onClick={() => setShowAddFolderModal(false)}>
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label>Folder Name</label>
                                    <input
                                        type="text"
                                        value={folderName}
                                        onChange={(e) => setFolderName(e.target.value)}
                                        placeholder="Enter folder name"
                                        autoFocus
                                    />
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button className="btn-secondary" onClick={() => setShowAddFolderModal(false)}>Cancel</button>
                                <button className="btn-primary" onClick={() => { handleCreateFolder(); setShowAddFolderModal(false); }}>Create</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Custom Delete Confirmation Modal */}
            {
                deleteConfirmation.isOpen && (
                    <div className="delete-confirmation-overlay" onClick={cancelDelete}>
                        <div className="delete-confirmation-modal" onClick={(e) => e.stopPropagation()}>
                            <div className="delete-modal-icon">
                                <Trash2 size={48} color="#ef4444" />
                            </div>
                            <h3>Confirm Deletion</h3>
                            <p>{deleteConfirmation.message}</p>
                            <div className="delete-modal-actions">
                                <button className="btn-cancel" onClick={cancelDelete}>
                                    Cancel
                                </button>
                                <button className="btn-delete" onClick={confirmDelete}>
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default SalesPage;
