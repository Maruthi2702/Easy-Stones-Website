import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Calendar, MapPin, Phone, Mail, Clock, Plus, Search,
    Filter, X, Upload, Home, ArrowLeft,
    CheckCircle, MessageSquare, Heart, ThumbsUp, Send, User, Menu,
    Edit, Trash2, Download, Share2, Pin, PinOff, ChevronLeft, ChevronRight,
    Info, DollarSign, ShieldCheck, FileText, Eye, Paperclip, Loader,
    CreditCard, Edit2, Hash, Smile, UserPlus, FolderPlus, Folder, Link,
    LayoutDashboard, Pencil, FileImage, File, MoreVertical, RefreshCw, FileSearch, ExternalLink
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
import DashboardStats from '../components/sales/DashboardStats';
import CustomerSidebar from '../components/sales/CustomerSidebar';
import VisitPostCard from '../components/sales/VisitPostCard';
import VisitModal from '../components/sales/VisitModal';
import ResourceModal from '../components/sales/ResourceModal';
import { formatDate } from '../utils/dateUtils';

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
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [selectedCustomerId, setSelectedCustomerId] = useState(null);
    const [selectedCustomerDetail, setSelectedCustomerDetail] = useState(null);
    const [allCustomersForSelection, setAllCustomersForSelection] = useState([]);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState('visits');

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCustomers, setTotalCustomers] = useState(0);
    const customersPerPage = 50;

    // Dashboard State (Required for memoized values)
    const [dashboardTimeRange, setDashboardTimeRange] = useState('1day');
    const [dashboardSearchTerm, setDashboardSearchTerm] = useState('');
    const [activeDashboardTab, setActiveDashboardTab] = useState('visits'); // 'visits' or 'resources'
    const [followupFilter, setFollowupFilter] = useState('all'); // 'all' or 'nextWeek'
    const [todayScheduleCount, setTodayScheduleCount] = useState(0);
    const [stats, setStats] = useState({ visits: 0, keyVisits: 0, bids: 0, followUp: 0, resources: 0 });
    const [statsLoading, setStatsLoading] = useState(true);
    const [dashboardVisits, setDashboardVisits] = useState([]);
    const [dashboardResources, setDashboardResources] = useState([]);
    const [dashboardDataLoading, setDashboardDataLoading] = useState(false);
    const [allSchedules, setAllSchedules] = useState([]);
    const [activeResourceSubTab, setActiveResourceSubTab] = useState('client'); // 'client' or 'team'
    const [currentUserId, setCurrentUserId] = useState(currentUser?.id || currentUser?._id || null);

    // Sync currentUserId when currentUser changes
    useEffect(() => {
        if (currentUser) {
            setCurrentUserId(currentUser.id || currentUser._id);
        }
    }, [currentUser]);

    // Fetch Dashboard Stats from Backend
    const fetchDashboardStats = useCallback(async () => {
        setStatsLoading(true);
        try {
            const response = await fetch(`${API_URL}/api/dashboard/stats?timeRange=${dashboardTimeRange}`, {
                credentials: 'include'
            });
            if (response.ok) {
                const data = await response.json();
                setStats(data);
                // Also update todayScheduleCount if provided by backend stats
                if (data.todayScheduleCount !== undefined) {
                    setTodayScheduleCount(data.todayScheduleCount);
                }
            }
        } catch (error) {
            console.error('Error fetching dashboard stats:', error);
        } finally {
            setStatsLoading(false);
        }
    }, [dashboardTimeRange]);

    useEffect(() => {
        fetchDashboardStats();
    }, [fetchDashboardStats]);

    // Fetch Independent Dashboard Data
    const fetchDashboardData = useCallback(async () => {
        setDashboardDataLoading(true);
        try {
            const [visitsRes, resourcesRes] = await Promise.all([
                fetch(`${API_URL}/api/dashboard/visits?timeRange=${dashboardTimeRange}`, { credentials: 'include' }),
                fetch(`${API_URL}/api/dashboard/resources?timeRange=${dashboardTimeRange}`, { credentials: 'include' })
            ]);

            if (visitsRes.ok) {
                const data = await visitsRes.json();
                setDashboardVisits(data);
            }
            if (resourcesRes.ok) {
                const data = await resourcesRes.json();
                setDashboardResources(data);
            }
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
        } finally {
            setDashboardDataLoading(false);
        }
    }, [dashboardTimeRange]);

    useEffect(() => {
        fetchDashboardData();
    }, [fetchDashboardData]);

    // Fetch schedules for the dashboard
    useEffect(() => {
        const fetchSchedules = async () => {
            try {
                // Fetch a broad range of schedules for the dashboard (e.g., +/- 1 month)
                const now = new Date();
                const start = new Date(now);
                start.setMonth(now.getMonth() - 1);
                const end = new Date(now);
                end.setMonth(now.getMonth() + 1);

                const response = await fetch(`${API_URL}/api/schedule?start=${start.toISOString()}&end=${end.toISOString()}`, {
                    credentials: 'include'
                });
                if (response.ok) {
                    const data = await response.json();
                    setAllSchedules(data);

                    // Update today's count from the fetched data
                    const todayStart = new Date();
                    todayStart.setHours(0, 0, 0, 0);
                    const todayEnd = new Date();
                    todayEnd.setHours(23, 59, 59, 999);

                    const todayCount = data.filter(s => {
                        const d = new Date(s.startTime);
                        return d >= todayStart && d <= todayEnd;
                    }).length;
                    setTodayScheduleCount(todayCount);
                }
            } catch (error) {
                console.error('Error fetching schedules:', error);
            }
        };
        fetchSchedules();
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
        const sourceData = allCustomersForSelection.length > 0 ? allCustomersForSelection : (customers || []);
        // Sort and map in one pass to avoid creating intermediate arrays
        return sourceData
            .slice() // Create a shallow copy to avoid mutating original
            .sort((a, b) => (a.company || a.contactName || '').localeCompare(b.company || b.contactName || ''))
            .map(c => ({
                value: c._id,
                label: c.company || c.contactName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown'
            }));
    }, [allCustomersForSelection, customers]);

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
        // If we are using the dedicated dashboardVisits/dashboardResources from the backend,
        // we should trust the backend's date filtering. 
        // We only use this local start date if we fallback to the allVisits/allResources lists.
        if (dashboardVisits.length > 0 || dashboardResources.length > 0) return null;

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


    const memoizedFilteredVisits = React.useMemo(() => {
        const startDate = dashboardDateRangeStart;
        const searchLower = dashboardSearchTerm.toLowerCase();
        const currentUserIdStr = currentUserId?.toString();

        // Use dashboardVisits if we have them, otherwise fallback to sidebar-derived allVisits
        const sourceVisits = dashboardVisits.length > 0 || (dashboardTimeRange !== 'all' && dashboardVisits.length === 0 && !dashboardDataLoading)
            ? dashboardVisits
            : allVisits;

        return sourceVisits.filter(v => {
            if (!v) return false;

            // If using dashboardVisits, backend already filtered by date.
            // Only apply dateMatch if we fell back to allVisits.
            const isFromBackend = sourceVisits === dashboardVisits;
            const visitDate = new Date(v.date || v.createdAt);
            const dateMatch = isFromBackend || !startDate || visitDate >= startDate;

            // Strictly filter by current user for dashboard view
            const userMatch = v.createdBy === currentUserIdStr;
            const searchMatch = !dashboardSearchTerm ||
                (v.customerName?.toLowerCase().includes(searchLower)) ||
                (v.notes?.toLowerCase().includes(searchLower)) ||
                (v.purpose?.toLowerCase().includes(searchLower));

            const isSystemEntry = v.purpose?.toLowerCase().match(/quick note|resource placement|resource update|new tower/i);

            // Exclude system entries from visits tab, but allow searching for them if needed? 
            // The request is to align with stats which exclude them.
            // If active tab is followups, we currently allow them in the source list, but filter later?
            // Actually, let's filter them out from the main filtered list unless specifically searching?

            const systemEntryExclude = true;

            return dateMatch && userMatch && searchMatch && systemEntryExclude;
        });

        return [...filtered].sort((a, b) => new Date(b?.date || b?.createdAt || 0) - new Date(a?.date || a?.createdAt || 0));
    }, [allVisits, dashboardVisits, dashboardDateRangeStart, currentUser, currentUserId, dashboardSearchTerm, activeDashboardTab, dashboardTimeRange, dashboardDataLoading]);

    const memoizedFilteredResources = React.useMemo(() => {
        const startDate = dashboardDateRangeStart;
        const searchLower = dashboardSearchTerm.toLowerCase();
        const currentUserIdStr = currentUserId?.toString();

        // Use dashboardResources if we have them
        const sourceResources = dashboardResources.length > 0 || (dashboardTimeRange !== 'all' && dashboardResources.length === 0 && !dashboardDataLoading)
            ? dashboardResources
            : allResources;

        return sourceResources.filter(r => {
            if (!r) return false;

            // If using dashboardResources, backend already filtered by date.
            const isFromBackend = sourceResources === dashboardResources;
            const resourceDate = new Date(r.date || r.createdAt);
            const dateMatch = isFromBackend || !startDate || resourceDate >= startDate;

            // Strictly filter by current user for dashboard view
            const userMatch = (r.uploadedBy === currentUserIdStr || r.createdBy === currentUserIdStr);
            const searchMatch = !dashboardSearchTerm ||
                (r.customerName?.toLowerCase().includes(searchLower)) ||
                (r.description?.toLowerCase().includes(searchLower)) ||
                (r.resourceType?.toLowerCase().includes(searchLower)) ||
                (r.notes?.toLowerCase().includes(searchLower));

            return dateMatch && userMatch && searchMatch;
        });

        return [...filtered].sort((a, b) => new Date(b?.date || b?.createdAt || 0) - new Date(a?.date || a?.createdAt || 0));
    }, [allResources, dashboardResources, dashboardDateRangeStart, currentUser, currentUserId, dashboardSearchTerm, dashboardTimeRange, dashboardDataLoading]);
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
        followUp: '',
        followUpDate: '',
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

    const [showDashboard, setShowDashboard] = useState(true);
    const [showDashboardUploadModal, setShowDashboardUploadModal] = useState(false);
    const [loadingVisitId, setLoadingVisitId] = useState(null);
    const [loadingResourceId, setLoadingResourceId] = useState(null);

    // Custom Delete Confirmation Modal
    const [deleteConfirmation, setDeleteConfirmation] = useState({
        isOpen: false,
        isDeleting: false,
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
    const [currentFollowUpPage, setCurrentFollowUpPage] = useState(1);
    const [currentResourcesPage, setCurrentResourcesPage] = useState(1);
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
        fetchAllCustomersForDropdown();
        // fetchDashboardResources will be called by its own useEffect when tab is active
    }, []);

    const fetchAllCustomersForDropdown = async () => {
        try {
            const response = await fetch(`${API_URL}/api/customers/dropdown`, {
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                setAllCustomersForSelection(data);
            }
        } catch (error) {
            console.error('Error fetching all customers for dropdown:', error);
        }
    };

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


    // Fetch Sales Dashboard Resources
    const fetchDashboardResources = async () => {
        try {
            const query = currentFolderId ? `?parentId=${currentFolderId}` : '';
            const url = `${API_URL}/api/sales-dashboard/resources${query}`;

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                credentials: 'include'
            });
            if (response.ok) {
                const data = await response.json();

                setSalesResources(data);
            } else {
                console.error('❌ [FETCH] Failed to fetch resources:', response.status, response.statusText);
            }
        } catch (error) {
            console.error('❌ [FETCH] Error fetching dashboard resources:', error);
        }
    };

    useEffect(() => {
        if (showDashboard && activeResourceSubTab === 'team') {
            fetchDashboardResources();
        }
    }, [showDashboard, currentFolderId, activeResourceSubTab]);

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

    useEffect(() => {
        const timer = setTimeout(() => {
            // Only update and reset if the search term actually changed
            if (searchTerm !== debouncedSearch) {
                setDebouncedSearch(searchTerm);
                setDebouncedSearch(searchTerm);
                setCurrentPage(1); // Reset to page 1 on search
                setCurrentVisitsPage(1);
                setCurrentFollowUpPage(1);
                setCurrentResourcesPage(1);
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm, debouncedSearch]);

    const fetchCustomers = useCallback(async () => {
        try {
            const response = await fetch(`${API_URL}/api/customers?page=${currentPage}&limit=${customersPerPage}&search=${encodeURIComponent(debouncedSearch)}`, {
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                setCustomers(data.customers || []);
                setTotalPages(data.pages || 1);
                setTotalCustomers(data.total || 0);
            } else {
                if (response.status === 401) {
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
    }, [currentPage, debouncedSearch]);

    useEffect(() => {
        fetchCustomers();
    }, [fetchCustomers]);

    // Optimized function to fetch only the selected customer
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

    const filteredCustomers = [...(Array.isArray(customers) ? customers : [])]
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

        setDeleteConfirmation(prev => ({ ...prev, isDeleting: true }));

        if (!targetCustomerId && type !== 'dashboardResource') {
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
            } else if (type === 'dashboardResource') {
                response = await fetch(`${API_URL}/api/sales-dashboard/resources/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    credentials: 'include'
                });
            }

            if (response && response.ok) {
                // If we're on the Dashboard view (dashboard tabs), refresh dashboard data
                const isDashboardView = activeDashboardTab === 'visits' || activeDashboardTab === 'resources' || activeDashboardTab === 'followups';

                if (type === 'dashboardResource') {
                    fetchDashboardResources();
                } else {
                    if (!selectedCustomerId && isDashboardView) {
                        await fetchDashboardData();
                        await fetchDashboardStats();
                    } else {
                        // Otherwise, refresh the selected customer's data
                        await fetchSingleCustomer(targetCustomerId);
                    }
                }
                setDeleteConfirmation({ isOpen: false, isDeleting: false, type: '', id: null, customerId: null, message: '' });
            } else {
                setDeleteConfirmation(prev => ({ ...prev, isDeleting: false }));
                alert(`Failed to delete ${type}`);
            }
        } catch (error) {
            console.error(`Error deleting ${type}:`, error);
            setDeleteConfirmation(prev => ({ ...prev, isDeleting: false }));
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
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                credentials: 'include',
                body: formData // Content-Type is set automatically
            });
            if (response.ok) {
                const result = await response.json();

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
        setDeleteConfirmation({
            isOpen: true,
            isDeleting: false,
            type: 'dashboardResource',
            id: resourceId,
            message: 'Are you sure you want to delete this resource?'
        });
    };

    const ensureResourceContent = async (resource) => {
        if (resource.isFolder || resource.type === 'link') return resource;
        if (resource.content) return resource;

        try {
            const response = await fetch(`${API_URL}/api/sales-dashboard/resources/${resource._id}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                credentials: 'include'
            });
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
                if (navigator.share && fullResource.content && (fullResource.content.startsWith('http') || fullResource.content.startsWith('data:') || fullResource.content.startsWith('/uploads/'))) {
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
            followUp: '',
            followUpDate: '',
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
                followUpDate: visit.followUpDate ? formatForDateInput(visit.followUpDate) : '',
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
                const formattedVisit = {
                    ...data.visit,
                    customerId: visit.customerId, // Preserve customerId
                    date: formatForDateInput(data.visit.date),
                    followUpDate: data.visit.followUpDate ? formatForDateInput(data.visit.followUpDate) : ''
                };
                setVisitForm(formattedVisit);
                setEditingVisit(formattedVisit);
            } else {
                const formattedVisit = {
                    ...visit,
                    date: formatForDateInput(visit.date),
                    followUpDate: visit.followUpDate ? formatForDateInput(visit.followUpDate) : ''
                };
                setVisitForm(formattedVisit);
                setEditingVisit(formattedVisit);
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


            if (data && data.visit) {
                const formattedVisit = {
                    ...data.visit,
                    customerId: visit.customerId, // Preserve customerId
                    date: formatForDateInput(data.visit.date),
                    followUpDate: data.visit.followUpDate ? formatForDateInput(data.visit.followUpDate) : ''
                };
                setVisitForm(formattedVisit);
                setEditingVisit(formattedVisit);
            } else {
                const formattedVisit = {
                    ...visit,
                    date: formatForDateInput(visit.date),
                    followUpDate: visit.followUpDate ? formatForDateInput(visit.followUpDate) : ''
                };
                setVisitForm(formattedVisit);
                setEditingVisit(formattedVisit);
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
            followUpDate: '',
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

            // Parse date to ensure it doesn't shift timezones
            // If it's a simple YYYY-MM-DD string, append T12:00:00 to keep it in the middle of the day
            // ensuring it stays on the same day regardless of UTC shift
            let payloadDate = visitForm.date;
            if (visitForm.date && /^\d{4}-\d{2}-\d{2}$/.test(visitForm.date)) {
                // Check if it's "today"
                const today = new Date();
                const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

                if (visitForm.date === todayStr) {
                    // For today, use actual current time to be precise
                    payloadDate = new Date().toISOString();
                } else {
                    // For other days, pick Noon to be safe
                    payloadDate = `${visitForm.date}T12:00:00.000`; // Local noon-ish
                    // Actually, to be safer with backend "new Date()" which assumes UTC if valid ISO...
                    // If we send "YYYY-MM-DDT12:00:00.000", new Date() often treats as Local if no Z?
                    // Let's explicitly check what backend does. 
                    // Backend uses new Date(val). 
                    // If we send "2026-02-02T12:00:00.000" (no Z), browser/node might treat as Local.
                    // If we send "2026-02-02T12:00:00.000Z", it is UTC noon.
                    // UTC Noon is 4AM PST. That is safe (same day).
                    // UTC Noon is 7AM EST. Safe.
                    // UTC Noon is 8PM China. Safe.
                    payloadDate = `${visitForm.date}T12:00:00.000Z`;
                }
            }

            const payload = {
                ...visitForm,
                date: payloadDate,
                followUpDate: visitForm.followUpDate
                    ? (visitForm.followUpDate.match(/^\d{4}-\d{2}-\d{2}$/)
                        ? `${visitForm.followUpDate}T12:00:00.000Z`
                        : visitForm.followUpDate)
                    : ''
            };

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
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
            followUpDate: '',
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
        if (!folderName || !folderName.trim()) {
            alert('Please enter a folder name');
            return;
        }

        try {
            const response = await fetch(`${API_URL}/api/sales-dashboard/upload`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                credentials: 'include',
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

    const handleEditDashboardResource = (resource) => {
        setEditingDashboardResource(resource);
        setDashboardUploadForm({
            name: resource.name,
            type: resource.type,
            content: resource.type === 'link' ? resource.content : '',
            file: null
        });
        setIsExistingFileRemoved(false);
        setShowDashboardUploadModal(true);
    };

    const handleDeleteDashboardResource = async (resourceId) => {
        setDeleteConfirmation({
            isOpen: true,
            isDeleting: false,
            type: 'dashboardResource',
            id: resourceId,
            message: 'Are you sure you want to delete this resource? If it is a folder, all its contents will be deleted.'
        });
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
                    const response = await fetch(`${API_URL}/api/sales-dashboard/resources/${resource._id}`, {
                        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                        credentials: 'include'
                    });
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
                const formattedResource = {
                    ...data.resource,
                    customerId: resource.customerId, // Preserve customerId
                    date: formatForDateInput(data.resource.date)
                };
                setResourceForm(formattedResource);
                setEditingResource(formattedResource);
                setImagePreview(Array.isArray(data.resource.image) && data.resource.image.length > 0 ? data.resource.image[0] : (data.resource.image || null));
            } else {
                const formattedResource = {
                    ...resource,
                    date: formatForDateInput(resource.date)
                };
                setResourceForm(formattedResource);
                setEditingResource(formattedResource);
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
                const formattedResource = {
                    ...data.resource,
                    customerId: resource.customerId, // Preserve customerId
                    date: formatForDateInput(data.resource.date)
                };
                setResourceForm(formattedResource);
                setEditingResource(formattedResource);
                const getFirstImage = (imgData) => {
                    if (!imgData) return null;
                    if (Array.isArray(imgData)) return imgData[0];
                    if (typeof imgData === 'string') {
                        if (imgData.startsWith('[') && imgData.endsWith(']')) {
                            try { return JSON.parse(imgData)[0]; } catch (e) { }
                        }
                        return imgData.split(',')[0].trim();
                    }
                    return null;
                };

                const firstImg = getFirstImage(data.resource.image);
                setImagePreview(firstImg);
            } else {
                const formattedResource = {
                    ...resource,
                    date: formatForDateInput(resource.date)
                };
                setResourceForm(formattedResource);
                setEditingResource(formattedResource);

                const getFirstImage = (imgData) => {
                    if (!imgData) return null;
                    if (Array.isArray(imgData)) return imgData[0];
                    if (typeof imgData === 'string') {
                        if (imgData.startsWith('[') && imgData.endsWith(']')) {
                            try { return JSON.parse(imgData)[0]; } catch (e) { }
                        }
                        return imgData.split(',')[0].trim();
                    }
                    return null;
                };
                setImagePreview(getFirstImage(resource.image));
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
    const handleResourceImageUpload = async (e) => {
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
            {/* Sidebar Overlay */}
            {!isPinned && isSidebarOpen && (
                <div
                    className="sidebar-overlay-backdrop"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <CustomerSidebar
                isSidebarOpen={isSidebarOpen}
                isMobile={isMobile}
                isPinned={isPinned}
                sidebarWidth={sidebarWidth}
                startResizing={startResizing}
                filteredCustomers={filteredCustomers}
                selectedCustomerId={selectedCustomerId}
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                loading={loading}
                error={error}
                togglePin={togglePin}
                setIsSidebarOpen={setIsSidebarOpen}
                handleGoHome={handleGoHome}
                handleSelectCustomer={handleSelectCustomer}
                currentPage={currentPage}
                setCurrentPage={setCurrentPage}
                totalPages={totalPages}
                totalCustomers={totalCustomers}
            />

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
                                                        [...selectedCustomer.visits].reverse().map(visit => (
                                                            <VisitPostCard
                                                                key={visit._id}
                                                                visit={visit}
                                                                currentUser={currentUser}
                                                                currentUserId={currentUserId}
                                                                formatDate={formatDate}
                                                                handleReaction={handleReaction}
                                                                activeReactionMessageId={activeReactionMessageId}
                                                                setActiveReactionMessageId={setActiveReactionMessageId}
                                                                handleEditVisit={handleEditVisit}
                                                                handleDeleteVisit={handleDeleteVisit}
                                                                handleOpenGallery={handleOpenGallery}
                                                            />
                                                        ))
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
                                                                                                        loading="lazy"
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
                                                        <span className="separator">/</span>
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

                                    <DashboardStats
                                        stats={stats}
                                        statsLoading={statsLoading}
                                        dashboardTimeRange={dashboardTimeRange}
                                        setDashboardTimeRange={setDashboardTimeRange}
                                        activeDashboardTab={activeDashboardTab}
                                        setActiveDashboardTab={setActiveDashboardTab}
                                        todayScheduleCount={todayScheduleCount}

                                    />


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

                                    {/* Follow-up Actions Table */}
                                    {activeDashboardTab === 'followups' && (
                                        <div className="visits-table-section">
                                            <div className="section-header">
                                                <h2>Follow-up Actions</h2>
                                                <div className="table-controls">
                                                    <div className="dashboard-sub-tabs" style={{ marginBottom: 0, border: 'none' }}>
                                                        <button
                                                            className={`sub-tab-btn ${followupFilter === 'all' ? 'active' : ''}`}
                                                            onClick={() => setFollowupFilter('all')}
                                                            style={{ padding: '0.5rem 1rem' }}
                                                        >
                                                            All Notes
                                                        </button>
                                                        <button
                                                            className={`sub-tab-btn ${followupFilter === 'nextWeek' ? 'active' : ''}`}
                                                            onClick={() => setFollowupFilter('nextWeek')}
                                                            style={{ padding: '0.5rem 1rem' }}
                                                        >
                                                            Next Week
                                                        </button>
                                                    </div>
                                                    <button className="export-btn" onClick={() => {
                                                        const followups = memoizedFilteredVisits.filter(v => v && (v.nextAction || v.followUp));
                                                        handleExportVisits(followups);
                                                    }}>
                                                        <Download size={18} /> Excel
                                                    </button>
                                                    <div className="table-search">
                                                        <input
                                                            type="text"
                                                            placeholder="Search follow-ups..."
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
                                                            <th>Action Item / Note</th>
                                                            <th className="mobile-hide">Source</th>
                                                            <th>Action</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {(() => {
                                                            let followups = [];
                                                            if (followupFilter === 'all') {
                                                                followups = memoizedFilteredVisits
                                                                    .filter(v => v && (v.nextAction || v.followUp))
                                                                    .map(v => ({
                                                                        ...v,
                                                                        displayDate: v.followUpDate || v.date,
                                                                        displayNote: v.nextAction || v.followUp,
                                                                        source: 'Visit'
                                                                    }));
                                                            } else if (followupFilter === 'nextWeek') {
                                                                const now = new Date();
                                                                const startOfNextWeek = new Date(now);
                                                                startOfNextWeek.setDate(now.getDate() + (8 - now.getDay()) % 7 || 7);
                                                                startOfNextWeek.setHours(0, 0, 0, 0);
                                                                const endOfNextWeek = new Date(startOfNextWeek);
                                                                endOfNextWeek.setDate(startOfNextWeek.getDate() + 6);
                                                                endOfNextWeek.setHours(23, 59, 59, 999);

                                                                const nextWeekSchedules = allSchedules.filter(s => {
                                                                    const d = new Date(s.startTime);
                                                                    return d >= startOfNextWeek && d <= endOfNextWeek;
                                                                }).map(s => {
                                                                    const targetId = s.customerId?._id || s.customerId;
                                                                    const customer = customers.find(c => String(c._id) === String(targetId));
                                                                    const customerName = customer
                                                                        ? (customer.company || customer.contactName || `${customer.firstName || ''} ${customer.lastName || ''}`.trim())
                                                                        : (s.customerId?.company || s.customerId?.contactName || 'Unknown Customer');

                                                                    return {
                                                                        _id: s._id,
                                                                        customerId: targetId,
                                                                        customerName,
                                                                        displayDate: s.startTime,
                                                                        displayNote: s.notes || 'Scheduled Follow-up',
                                                                        source: 'Planner',
                                                                        isSchedule: true
                                                                    };
                                                                });
                                                                const nextWeekVisits = memoizedFilteredVisits.filter(v => {
                                                                    if (!v.followUpDate) return false;
                                                                    const d = new Date(v.followUpDate);
                                                                    return d >= startOfNextWeek && d <= endOfNextWeek;
                                                                }).map(v => ({
                                                                    ...v,
                                                                    displayDate: v.followUpDate,
                                                                    displayNote: v.followUp || v.nextAction || 'Follow-up Visit',
                                                                    source: 'Visit'
                                                                }));

                                                                followups = [...nextWeekSchedules, ...nextWeekVisits];
                                                            }

                                                            if (dashboardSearchTerm) {
                                                                const term = dashboardSearchTerm.toLowerCase();
                                                                followups = followups.filter(f =>
                                                                    f.customerName?.toLowerCase().includes(term) ||
                                                                    f.displayNote?.toLowerCase().includes(term)
                                                                );
                                                            }

                                                            if (followups.length === 0) {
                                                                return (
                                                                    <tr>
                                                                        <td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>
                                                                            {followupFilter === 'nextWeek' ? 'No follow-ups scheduled for next week' : 'No follow-up notes found'}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            }
                                                            const indexOfLastItem = currentFollowUpPage * visitsPerPage;
                                                            const indexOfFirstItem = indexOfLastItem - visitsPerPage;
                                                            const currentItems = followups.slice(indexOfFirstItem, indexOfLastItem);

                                                            return currentItems.map((item, index) => (
                                                                <tr key={item._id || index}>
                                                                    <td className="mobile-hide">{formatDate(item.displayDate, { month: 'numeric', day: 'numeric', year: 'numeric' })}</td>
                                                                    <td>
                                                                        <span
                                                                            className="link"
                                                                            onClick={() => {
                                                                                const customer = customers.find(c => String(c._id) === String(item.customerId));
                                                                                if (customer) handleSelectCustomer(customer);
                                                                            }}
                                                                        >
                                                                            {item.customerName}
                                                                        </span>
                                                                    </td>
                                                                    <td>
                                                                        <div title={item.displayNote} style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                            {item.displayNote}
                                                                        </div>
                                                                    </td>
                                                                    <td className="mobile-hide">
                                                                        <span className={`status-badge ${item.source === 'Planner' ? 'completed' : 'pending'}`}>
                                                                            {item.source}
                                                                        </span>
                                                                    </td>
                                                                    <td>
                                                                        <div style={{ display: 'flex', gap: '8px' }}>
                                                                            {item.isSchedule ? (
                                                                                <button
                                                                                    className="icon-btn-ghost"
                                                                                    onClick={() => setActiveDashboardTab('planner')}
                                                                                    title="View in Planner"
                                                                                >
                                                                                    <Calendar size={16} />
                                                                                </button>
                                                                            ) : (
                                                                                <>
                                                                                    <button
                                                                                        className="icon-btn-ghost"
                                                                                        onClick={() => handleViewVisit(item)}
                                                                                        title="View Details"
                                                                                    >
                                                                                        <Eye size={16} />
                                                                                    </button>
                                                                                    <button
                                                                                        className="icon-btn-ghost"
                                                                                        onClick={() => handleEditVisit(item)}
                                                                                        title="Edit Visit"
                                                                                    >
                                                                                        <Pencil size={16} />
                                                                                    </button>
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            ));
                                                        })()}
                                                    </tbody>
                                                </table>
                                            </div>

                                            {/* Follow-up Pagination Controls */}
                                            {(() => {
                                                let followups = [];
                                                if (followupFilter === 'all') {
                                                    followups = memoizedFilteredVisits
                                                        .filter(v => v && (v.nextAction || v.followUp));
                                                } else if (followupFilter === 'nextWeek') {
                                                    const now = new Date();
                                                    const startOfNextWeek = new Date(now);
                                                    startOfNextWeek.setDate(now.getDate() + (8 - now.getDay()) % 7 || 7);
                                                    startOfNextWeek.setHours(0, 0, 0, 0);
                                                    const endOfNextWeek = new Date(startOfNextWeek);
                                                    endOfNextWeek.setDate(startOfNextWeek.getDate() + 6);
                                                    endOfNextWeek.setHours(23, 59, 59, 999);

                                                    const nextWeekSchedules = allSchedules.filter(s => {
                                                        const d = new Date(s.startTime);
                                                        return d >= startOfNextWeek && d <= endOfNextWeek;
                                                    });

                                                    const nextWeekVisits = memoizedFilteredVisits.filter(v => {
                                                        if (!v.followUpDate) return false;
                                                        const d = new Date(v.followUpDate);
                                                        return d >= startOfNextWeek && d <= endOfNextWeek;
                                                    });

                                                    followups = [...nextWeekSchedules, ...nextWeekVisits];
                                                }

                                                if (dashboardSearchTerm) {
                                                    const term = dashboardSearchTerm.toLowerCase();
                                                    followups = followups.filter(f => {
                                                        const customerName = f.customerName || (f.customerId?.company);
                                                        const note = f.displayNote || f.notes || f.nextAction || f.followUp;
                                                        return (customerName?.toLowerCase().includes(term) || note?.toLowerCase().includes(term));
                                                    });
                                                }

                                                const totalPages = Math.ceil(followups.length / visitsPerPage);

                                                if (totalPages <= 1) return null;

                                                const handlePageChange = (pageNumber) => {
                                                    setCurrentFollowUpPage(pageNumber);
                                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                                };

                                                return (
                                                    <div className="pagination-controls">
                                                        <button
                                                            className="pagination-btn"
                                                            onClick={() => handlePageChange(currentFollowUpPage - 1)}
                                                            disabled={currentFollowUpPage === 1}
                                                        >
                                                            ← Previous
                                                        </button>

                                                        <div className="pagination-pages">
                                                            {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
                                                                <button
                                                                    key={pageNum}
                                                                    className={`pagination-page ${currentFollowUpPage === pageNum ? 'active' : ''}`}
                                                                    onClick={() => handlePageChange(pageNum)}
                                                                >
                                                                    {pageNum}
                                                                </button>
                                                            ))}
                                                        </div>

                                                        <button
                                                            className="pagination-btn"
                                                            onClick={() => handlePageChange(currentFollowUpPage + 1)}
                                                            disabled={currentFollowUpPage === totalPages}
                                                        >
                                                            Next →
                                                        </button>

                                                        <div className="pagination-info">
                                                            Showing {((currentFollowUpPage - 1) * visitsPerPage) + 1}-{Math.min(currentFollowUpPage * visitsPerPage, followups.length)} of {followups.length} follow-ups
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
                                                                    <span className="separator">/</span>
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
                                                            <button
                                                                className="icon-action-btn secondary"
                                                                title="Refresh Files"
                                                                onClick={fetchDashboardResources}
                                                            >
                                                                <RefreshCw size={16} />
                                                            </button>
                                                            <button className="icon-action-btn secondary" onClick={() => { setFolderName(''); setShowAddFolderModal(true); }}>
                                                                <FolderPlus size={16} /> <span className="mobile-hide-text">Add Folder</span>
                                                            </button>
                                                            <button className="icon-action-btn primary" onClick={() => { setDashboardUploadForm({ name: '', type: 'file', content: '', file: null }); setEditingDashboardResource(null); setShowDashboardUploadModal(true); }}>
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
                                                                    const indexOfLastResource = currentResourcesPage * visitsPerPage;
                                                                    const indexOfFirstResource = indexOfLastResource - visitsPerPage;
                                                                    const currentResources = resources.slice(indexOfFirstResource, indexOfLastResource);

                                                                    return currentResources.map((resource, index) => (
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

                                                    {/* Resources Pagination Controls */}
                                                    {(() => {
                                                        const resources = memoizedFilteredResources;
                                                        const totalPages = Math.ceil(resources.length / visitsPerPage);

                                                        if (totalPages <= 1) return null;

                                                        const handlePageChange = (pageNumber) => {
                                                            setCurrentResourcesPage(pageNumber);
                                                            window.scrollTo({ top: 0, behavior: 'smooth' });
                                                        };

                                                        return (
                                                            <div className="pagination-controls">
                                                                <button
                                                                    className="pagination-btn"
                                                                    onClick={() => handlePageChange(currentResourcesPage - 1)}
                                                                    disabled={currentResourcesPage === 1}
                                                                >
                                                                    ← Previous
                                                                </button>

                                                                <div className="pagination-pages">
                                                                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
                                                                        <button
                                                                            key={pageNum}
                                                                            className={`pagination-page ${currentResourcesPage === pageNum ? 'active' : ''}`}
                                                                            onClick={() => handlePageChange(pageNum)}
                                                                        >
                                                                            {pageNum}
                                                                        </button>
                                                                    ))}
                                                                </div>

                                                                <button
                                                                    className="pagination-btn"
                                                                    onClick={() => handlePageChange(currentResourcesPage + 1)}
                                                                    disabled={currentResourcesPage === totalPages}
                                                                >
                                                                    Next →
                                                                </button>

                                                                <div className="pagination-info">
                                                                    Showing {((currentResourcesPage - 1) * visitsPerPage) + 1}-{Math.min(currentResourcesPage * visitsPerPage, resources.length)} of {resources.length} resources
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}
                                                </>
                                            )}

                                            {activeResourceSubTab === 'team' && (
                                                <div className="team-resources-content">
                                                    <div className="resources-list-container">
                                                        {folderPath.length > 0 && (
                                                            <div className="list-back-button" onClick={() => handleBreadcrumbClick(folderPath.length - 2)}>
                                                                <ArrowLeft size={16} />
                                                                <span>Back</span>
                                                            </div>
                                                        )}

                                                        {salesResources.length === 0 ? (
                                                            <div className="empty-resources-state">
                                                                <div className="empty-icon">
                                                                    <FileSearch size={48} />
                                                                </div>
                                                                <p>No files or folders found in this location</p>
                                                                <button className="btn-secondary small" onClick={() => setShowDashboardUploadModal(true)}>
                                                                    Upload your first file
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <table className="resources-table">
                                                                <thead>
                                                                    <tr>
                                                                        <th style={{ width: '40%' }}>Name</th>
                                                                        <th>Modified</th>
                                                                        <th>Modified By</th>
                                                                        <th style={{ width: '100px' }}></th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {salesResources.filter(r => !dashboardSearchTerm || r.name.toLowerCase().includes(dashboardSearchTerm.toLowerCase())).map(resource => {
                                                                        const isFolder = resource.type === 'folder';
                                                                        const isLink = resource.type === 'link';
                                                                        const isImage = resource.contentType?.startsWith('image/') || resource.name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                                                                        const isPdf = resource.contentType === 'application/pdf' || resource.name.toLowerCase().endsWith('.pdf');

                                                                        return (
                                                                            <tr
                                                                                key={resource._id}
                                                                                className="resource-row"
                                                                                onClick={() => handleResourceClick(resource)}
                                                                            >
                                                                                <td className="col-name">
                                                                                    <div className="resource-name-wrapper">
                                                                                        <span className={`resource-icon-small ${resource.type}`}>
                                                                                            {isFolder ? <Folder size={18} fill="currentColor" /> :
                                                                                                isLink ? <Link size={18} /> :
                                                                                                    isImage ? <FileImage size={18} /> :
                                                                                                        isPdf ? <FileText size={18} /> :
                                                                                                            <File size={18} />}
                                                                                        </span>
                                                                                        <span className="name-text">{resource.name}</span>
                                                                                    </div>
                                                                                </td>
                                                                                <td className="col-date">
                                                                                    {formatDate(resource.createdAt, { month: 'long', day: 'numeric', year: 'numeric' })}
                                                                                </td>
                                                                                <td className="col-user">
                                                                                    <span className="user-pill">
                                                                                        {resource.uploadedBy?.username ?
                                                                                            resource.uploadedBy.username.charAt(0).toUpperCase() + resource.uploadedBy.username.slice(1)
                                                                                            : 'Admin'}
                                                                                    </span>
                                                                                </td>
                                                                                <td className="col-actions">
                                                                                    <div className="row-actions">
                                                                                        <button
                                                                                            className="action-icon-btn edit"
                                                                                            onClick={(e) => { e.stopPropagation(); handleEditDashboardResource(resource); }}
                                                                                            title="Edit"
                                                                                        >
                                                                                            <Pencil size={14} />
                                                                                        </button>
                                                                                        <button
                                                                                            className="action-icon-btn delete"
                                                                                            onClick={(e) => { e.stopPropagation(); handleDeleteDashboardResource(resource._id); }}
                                                                                            title="Delete"
                                                                                        >
                                                                                            <Trash2 size={14} />
                                                                                        </button>
                                                                                    </div>
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Follow-ups Table */}
                                </>
                            )}
                        </div>
                    )}
                </ErrorBoundary>

                {/* Dashboard Resource Preview Modal */}
                {previewDashboardResource && (
                    <div className="modal-overlay preview-overlay" onClick={() => setPreviewDashboardResource(null)}>
                        <div className="modal-content preview-modal-content dark-theme" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header preview-header premium-header">
                                <div className="preview-file-info">
                                    <div className="preview-icon-badge">
                                        {previewDashboardResource.type === 'folder' ? <Folder size={20} className="text-gold" /> :
                                            previewDashboardResource.type === 'link' ? <Link size={20} className="text-blue" /> :
                                                (previewDashboardResource.contentType?.startsWith('image/') || previewDashboardResource.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)) ? <FileImage size={20} className="text-purple" /> :
                                                    (previewDashboardResource.contentType === 'application/pdf' || previewDashboardResource.name.toLowerCase().endsWith('.pdf')) ? <FileText size={20} className="text-red" /> :
                                                        <File size={20} className="text-gray" />}
                                    </div>
                                    <div className="preview-details">
                                        <h2 className="preview-title" title={previewDashboardResource.name}>{previewDashboardResource.name}</h2>
                                        <div className="preview-meta-row">
                                            <span className="preview-type-tag">{previewDashboardResource.type.toUpperCase()}</span>
                                            <span className="preview-separator">•</span>
                                            <span className="preview-date">{formatDate(previewDashboardResource.createdAt)}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="preview-actions">
                                    <a
                                        href={previewDashboardResource.content.startsWith('http') || previewDashboardResource.content.startsWith('data:') ? previewDashboardResource.content : `${API_URL}${previewDashboardResource.content}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="icon-btn-ghost preview-action-btn"
                                        title="Open in New Tab"
                                    >
                                        <ExternalLink size={20} />
                                    </a>
                                    <button
                                        className="icon-btn-ghost preview-action-btn"
                                        title="Download"
                                        onClick={() => handleDashboardDownload(previewDashboardResource)}
                                    >
                                        <Download size={20} />
                                    </button>
                                    <button className="close-preview-btn premium-close" onClick={() => setPreviewDashboardResource(null)}>
                                        <X size={24} />
                                    </button>
                                </div>
                            </div>
                            <div className="modal-body preview-body">
                                {previewDashboardResource.type === 'file' ? (
                                    (previewDashboardResource.content?.startsWith('data:image') ||
                                        (!previewDashboardResource.content?.startsWith('data:') &&
                                            (previewDashboardResource.contentType?.startsWith('image/') ||
                                                previewDashboardResource.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)))) ? (
                                        <div className="image-preview-container">
                                            <img
                                                src={previewDashboardResource.content.startsWith('http') || previewDashboardResource.content.startsWith('data:') ? previewDashboardResource.content : `${API_URL}${previewDashboardResource.content}`}
                                                alt={previewDashboardResource.name}
                                                className="preview-image"
                                                loading="lazy"
                                            />
                                        </div>
                                    ) : (previewDashboardResource.content?.startsWith('data:application/pdf') ||
                                        (!previewDashboardResource.content?.startsWith('data:') &&
                                            (previewDashboardResource.contentType === 'application/pdf' ||
                                                previewDashboardResource.name.toLowerCase().endsWith('.pdf')))) ? (
                                        <div className="pdf-preview-container">
                                            <object
                                                data={`${previewDashboardResource.content.startsWith('http') || previewDashboardResource.content.startsWith('data:') ? previewDashboardResource.content : `${API_URL}${previewDashboardResource.content}`}#toolbar=0`}
                                                type="application/pdf"
                                                className="preview-iframe"
                                                width="100%"
                                                height="100%"
                                            >
                                                <div className="no-preview-container" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                                    <p>Unable to display PDF preview.</p>
                                                    <button className="btn-primary small" onClick={() => handleDashboardDownload(previewDashboardResource)}>
                                                        Download PDF
                                                    </button>
                                                </div>
                                            </object>
                                        </div>
                                    ) : (
                                        <div className="no-preview-container">
                                            <File size={64} className="no-preview-icon" />
                                            <p>No preview available for this file type</p>
                                            <button className="btn-primary small" onClick={() => handleDashboardDownload(previewDashboardResource)}>
                                                Download to View
                                            </button>
                                        </div>
                                    )
                                ) : (
                                    <div className="link-preview-container">
                                        <Link size={48} />
                                        <p>This is a web link</p>
                                        <a href={previewDashboardResource.content} target="_blank" rel="noopener noreferrer" className="btn-primary">
                                            Open in New Tab
                                        </a>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

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
                <VisitModal
                    showVisitModal={showVisitModal}
                    isViewingVisit={isViewingVisit}
                    handleCloseVisitModal={handleCloseVisitModal}
                    editingVisit={editingVisit}
                    visitForm={visitForm}
                    setVisitForm={setVisitForm}
                    isMobile={isMobile}
                    customerOptions={customerOptions}
                    isSaving={isSaving}
                    handleSaveVisit={handleSaveVisit}
                    handleVisitImageUpload={handleVisitImageUpload}
                    handleRemoveVisitImage={handleRemoveVisitImage}
                    selectedCustomer={selectedCustomer}
                    customers={customers}
                    handleDashboardDownload={handleDashboardDownload}
                    setFullScreenImage={setFullScreenImage}
                />

                <ResourceModal
                    showResourceModal={showResourceModal}
                    setShowResourceModal={setShowResourceModal}
                    editingResource={editingResource}
                    isViewingResource={isViewingResource}
                    resourceForm={resourceForm}
                    setResourceForm={setResourceForm}
                    customerOptions={customerOptions}
                    customers={customers}
                    resourceTypes={resourceTypes}
                    formatDate={formatDate}
                    API_URL={API_URL}
                    isSaving={isSaving}
                    handleSaveResource={handleSaveResource}
                    handleResourceImageUpload={handleResourceImageUpload}
                    handleRemoveResourceImage={handleRemoveResourceImage}
                    handleDashboardDownload={handleDashboardDownload}
                    setFullScreenImage={setFullScreenImage}
                    handleOpenGallery={handleOpenGallery}
                />

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
                                    <img
                                        src={fullScreenImage.startsWith('data:') || fullScreenImage.startsWith('http') ? fullScreenImage : (fullScreenImage.startsWith('/uploads') ? `${API_URL}${fullScreenImage}` : `${API_URL}/uploads/resources/${fullScreenImage}`)}
                                        alt="Full Screen"
                                    />
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
                                                value={dashboardUploadForm.content || ''}
                                                onChange={(e) => setDashboardUploadForm({ ...dashboardUploadForm, content: e.target.value })}
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
                                    <button
                                        className="btn-cancel"
                                        onClick={cancelDelete}
                                        disabled={deleteConfirmation.isDeleting}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className="btn-delete"
                                        onClick={confirmDelete}
                                        disabled={deleteConfirmation.isDeleting}
                                        style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}
                                    >
                                        {deleteConfirmation.isDeleting ? (
                                            <>
                                                <Loader size={16} className="animate-spin" />
                                                Deleting...
                                            </>
                                        ) : (
                                            'Delete'
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                }
            </div >
        </div >
    );
};

export default SalesPage;
