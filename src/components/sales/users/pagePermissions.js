// Users & Roles' per-page permission definitions, shared with the Add/Edit
// user forms (role summaries) and the /admin screen.
import { summarizeRole } from '../../../utils/userForm';
import { FREIGHT, CARRIERS } from '../../../accounting/permissions';
import {
    ArrowLeftRight, Boxes, CheckCheck, ClipboardList, Clock, DollarSign, Edit2, Eraser, Eye, FileCog, LayoutDashboard, Mail as MailIcon, Map, MapPin, Palette, Pencil, Plus, QrCode, Receipt, RotateCcw, Route, ShieldCheck, Tag, Trash2, TrendingDown, Truck, Upload, User, UserCheck, Users
} from 'lucide-react';

// Granular per-page permission definitions.
// Each page has a set of "actions" that map to backend permission keys.
export const PAGE_PERMISSIONS = [
    {
        id: 'dashboard',
        page: 'Dashboard',
        icon: LayoutDashboard,
        description: 'CRM overview: charts, stats, calendar',
        color: '#6c8ebf',
        actions: [
            { key: 'view_dashboard', label: 'View', icon: Eye, desc: 'View dashboard charts and sales statistics' }
        ]
    },
    {
        id: 'customers',
        page: 'Customers',
        icon: User,
        description: 'Customer database and contacts',
        color: '#82b366',
        actions: [
            { key: 'view_customers',   label: 'View',   icon: Eye,    desc: 'View customer list and details' },
            { key: 'manage_customers', label: 'Edit / Add', icon: Pencil, desc: 'Add and edit customers and contacts (visits are under Visits)' },
            { key: 'delete_customers', label: 'Delete', icon: Trash2, desc: 'Delete customer records (visits are under Visits)' }
        ]
    },
    {
        // Checked by src/utils/visitAccess.js, on the server and for which
        // buttons the screens offer. Resources follow the same switches.
        // "Assigned branches" are the user's Locations.
        id: 'visits',
        page: 'Visits',
        icon: UserCheck,
        description: 'Logging, viewing, editing and deleting visits and resources',
        color: '#5b9aa0',
        actions: [
            { key: 'add_visits',           label: 'Add',           icon: Plus,   desc: 'Log visits and add resources' },
            { key: 'view_branch_visits',   label: 'View branch',   icon: MapPin, desc: "See everyone's visits and resources for customers in the user's assigned branches (everyone sees their own)" },
            { key: 'view_all_visits',      label: 'View all',      icon: Eye,    desc: "See every branch's visits and resources on the dashboard" },
            { key: 'edit_own_visits',      label: 'Edit own',      icon: Pencil, desc: 'Edit visits and resources the user logged themselves' },
            { key: 'edit_branch_visits',   label: 'Edit branch',   icon: Edit2,  desc: "Edit anyone's visits and resources on customers in the user's assigned branches" },
            { key: 'edit_all_visits',      label: 'Edit all',      icon: FileCog, desc: "Edit anyone's visits and resources" },
            { key: 'delete_own_visits',    label: 'Delete own',    icon: Eraser, desc: 'Delete visits and resources the user logged themselves' },
            { key: 'delete_branch_visits', label: 'Delete branch', icon: Trash2, desc: "Delete anyone's visits and resources on customers in the user's assigned branches" },
            { key: 'delete_all_visits',    label: 'Delete all',    icon: Trash2, desc: "Delete anyone's visits and resources" }
        ]
    },
    {
        id: 'checkins',
        page: 'Check-In Log',
        icon: Clock,
        description: 'Office check-ins and selection sheets',
        color: '#d79b00',
        actions: [
            { key: 'view_checkins',     label: 'View',             icon: Eye,      desc: 'View check-in log records (read-only without Edit)' },
            // The QR / NFC self check-in codes, in the log's More menu (2026-10-08).
            { key: 'view_checkin_qr',   label: 'QR / NFC',         icon: QrCode,   desc: 'See the QR / NFC self check-in codes in the More menu' },
            { key: 'send_checkin_email',label: 'Selection Sheet',  icon: MailIcon, desc: 'Send selection sheet emails to customers' },
            { key: 'manage_checkins',   label: 'Edit',             icon: Pencil,   desc: 'Edit check-in details and selection sheets' },
            { key: 'delete_checkins',   label: 'Delete',           icon: Trash2,   desc: 'Delete check-in records' }
        ]
    },
    {
        id: 'pricelist',
        page: 'Price List',
        icon: Tag,
        description: 'Price levels, margins, Excel download',
        color: '#9673a6',
        actions: [
            { key: 'view_pricelist',   label: 'View',            icon: Eye,    desc: 'View price lists and margins' },
            { key: 'manage_pricelist', label: 'Edit / Download', icon: FileCog, desc: 'Edit margin levels and download Excel' },
            { key: 'view_product_prices', label: 'View Product Prices', icon: Eye, desc: 'Allow viewing prices on product detail pages' }
        ]
    },
    {
        id: 'lost_sales',
        page: 'Lost Sales',
        icon: TrendingDown,
        description: 'Track lost revenue, competitor pricing & stock friction',
        color: '#ef4444',
        actions: [
            { key: 'view_lost_sales', label: 'View', icon: Eye, desc: 'View lost sales records and metrics' },
            { key: 'edit_lost_sales', label: 'Edit', icon: Pencil, desc: 'Record new lost sales and edit existing records' },
            { key: 'delete_lost_sales', label: 'Delete', icon: Trash2, desc: 'Delete lost sale records' }
        ]
    },
    {
        id: 'daily_report',
        page: 'Daily Report',
        icon: ClipboardList,
        description: 'The daily work report for a branch',
        color: '#0ea5a4',
        actions: [
            { key: 'view_daily_report',   label: 'View',    icon: Eye,       desc: 'Open the daily report and the month view' },
            { key: 'edit_daily_report',   label: 'Edit',    icon: Pencil,    desc: "Fill in and save the day's figures" },
            // Submit is separate from Edit: signing a day off is a statement,
            // not just another save.
            { key: 'submit_daily_report', label: 'Submit',  icon: CheckCheck, desc: 'Sign off a day and lock it' },
            { key: 'reopen_daily_report', label: 'Reopen',  icon: RotateCcw, desc: 'Unlock a submitted day to correct it' }
        ]
    },
    {
        id: 'delivery_schedule',
        page: 'Delivery Schedule',
        icon: Truck,
        description: 'Schedule, track, and dispatch slab deliveries',
        color: '#3b82f6',
        actions: [
            { key: 'view_delivery_schedule', label: 'View', icon: Eye, desc: 'View delivery schedules and routes' },
            { key: 'edit_delivery_schedule', label: 'Edit', icon: Pencil, desc: 'Schedule and edit delivery jobs — opens the full dispatch board (without it, the board is read-only)' },
            // Decides the screen, not just a button: src/utils/deliveryAccess.js.
            { key: 'delivery_driver_view', label: 'Driver view', icon: Truck, desc: 'Show only this user’s own stops, on the driver screen (no order search). Overrides Edit' },
            { key: 'delete_delivery_schedule', label: 'Delete', icon: Trash2, desc: 'Permanently delete delivery jobs (no undo)' },
            // Separate from Delete on purpose: voiding a proof the wrong customer
            // signed is a different level of trust from removing the job itself.
            { key: 'clear_pod_signatures', label: 'Clear POD', icon: Eraser, desc: 'Delete the signed packing list and reset signatures for re-signing' }
        ]
    },
    {
        id: 'route_planner',
        page: 'Route Planner',
        icon: Map,
        description: 'Plan a day of visits by area from the customer map',
        color: '#c33a3a',
        actions: [
            // View is the heavy one: the map shows every account's location and
            // how long since anyone called on it, which is the shape of the whole
            // territory in a single screen.
            { key: 'view_route_planner', label: 'View', icon: Eye, desc: 'Open the map and see accounts, locations and how overdue each visit is' },
            { key: 'create_route_plan', label: 'Plan', icon: Route, desc: 'Put a planned run of stops onto the calendar' },
            // Separate from Plan on purpose: overwriting a day someone already
            // planned is a different act from adding one.
            { key: 'edit_route_plan', label: 'Replace', icon: Pencil, desc: 'Replace a day that was already planned with a new run' },
            { key: 'delete_route_plan', label: 'Clear', icon: Trash2, desc: 'Clear the planned stops from a day (hand-added entries are left alone)' }
        ]
    },
    {
        id: 'crossover_sheet',
        page: 'Crossover Sheet',
        icon: ArrowLeftRight,
        description: "Distributor color names mapped to their Easy Stones equivalent",
        color: '#f59e0b',
        actions: [
            { key: 'view_crossover_sheet', label: 'View', icon: Eye, desc: 'View the crossover sheet' },
            { key: 'add_crossover_sheet', label: 'Add', icon: Plus, desc: 'Add new crossover entries' },
            { key: 'edit_crossover_sheet', label: 'Edit', icon: Pencil, desc: 'Edit existing crossover entries' },
            { key: 'delete_crossover_sheet', label: 'Delete', icon: Trash2, desc: 'Delete crossover entries' },
            { key: 'manage_easy_stones_colors', label: 'Manage Colors', icon: Palette, desc: 'Add, rename, or delete Easy Stones catalog colors (the master list every crossover maps against)' }
        ]
    },
    {
        id: 'inventory_analysis',
        page: 'Inventory Analysis',
        icon: Boxes,
        description: 'Stock levels, aging, and reorder analysis from SPS exports',
        color: '#0891b2',
        actions: [
            { key: 'view_inventory_analysis', label: 'View', icon: Eye, desc: 'View stock levels, aging, and reorder analysis' },
            { key: 'import_inventory_analysis', label: 'Import', icon: Upload, desc: 'Import new SPS inventory/sales exports (replaces current stock data)' },
            // Separate from View on purpose: seeing stock levels and seeing what
            // that stock cost/is worth are different levels of trust.
            { key: 'view_inventory_prices', label: 'View Prices', icon: DollarSign, desc: 'See dollar value/cost figures on lots and slabs' }
        ]
    },
    // Accounting (src/accounting/permissions.js, 2026-10-09). Nothing in
    // Accounting opens by role name: every action is one of these switches,
    // and the server checks each one plus the person's branches.
    {
        id: 'accounting_freight',
        page: 'Accounting · 3rd-Party Freight',
        icon: Receipt,
        description: 'What we owe contract carriers for completed deliveries, and their invoices',
        color: '#0f766e',
        actions: [
            { key: FREIGHT.VIEW,    label: 'View',         icon: Eye,        desc: 'See freight charges, carrier invoices and their amounts (assigned branches only)' },
            { key: FREIGHT.ADD,     label: 'Add',          icon: Plus,       desc: 'Add a charge by hand and enter carrier invoices' },
            { key: FREIGHT.EDIT,    label: 'Edit',         icon: Pencil,     desc: 'Correct a charge or invoice while it waits for approval, and clear review flags' },
            { key: FREIGHT.APPROVE, label: 'Approve',      icon: CheckCheck, desc: 'Approve charges and invoices for payment (and send them back)' },
            { key: FREIGHT.PAY,     label: 'Mark paid',    icon: DollarSign, desc: 'Record payments: date, method, check or reference # — each gets a payment ID. With Approve too, a charge or invoice can be approved and paid in one step' },
            { key: FREIGHT.VOID,    label: 'Void',         icon: Trash2,     desc: 'Cancel a charge or invoice with a reason — nothing is ever deleted' },
            { key: FREIGHT.EXPORT,  label: 'Export',       icon: Upload,     desc: 'Download charges as Excel' },
            { key: FREIGHT.HISTORY, label: 'View history', icon: Clock,      desc: 'See who changed what, and when' }
        ]
    },
    {
        id: 'accounting_carriers',
        page: 'Accounting · Carriers',
        icon: Truck,
        description: 'Contract carriers and how each is paid (per delivery or per invoice)',
        color: '#0e7490',
        actions: [
            { key: CARRIERS.VIEW,       label: 'View',       icon: Eye,    desc: 'See the carrier list' },
            { key: CARRIERS.ADD,        label: 'Add',        icon: Plus,   desc: 'Add carriers' },
            { key: CARRIERS.EDIT,       label: 'Edit',       icon: Pencil, desc: 'Rename carriers, set other spellings and how they are paid' },
            { key: CARRIERS.DEACTIVATE, label: 'Deactivate', icon: Eraser, desc: 'Deactivate or reactivate a carrier' }
        ]
    },
    {
        id: 'users',
        page: 'Users & Roles',
        icon: Users,
        description: 'User accounts, roles, permissions',
        color: '#ae4132',
        actions: [
            { key: 'manage_users', label: 'Manage', icon: ShieldCheck, desc: 'Add/edit users and customize role permissions' }
        ]
    }
];


/**
 * One line describing what a role can open — the Add/Edit user role picker's
 * description, e.g. "Driver screen · Delivery Schedule".
 */
export const describeRole = (role) => summarizeRole(role?.permissions || [], PAGE_PERMISSIONS);

/** Whether a role puts its people on the delivery board as a truck column. */
export const isDriverRole = (role) => (role?.permissions || []).includes('delivery_driver_view');
