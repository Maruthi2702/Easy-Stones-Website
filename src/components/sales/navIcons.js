import {
    LayoutDashboard, User, Clock, Truck, Map as MapIcon, ClipboardList, Tag, TrendingDown, ArrowLeftRight, Boxes,
    Users, Briefcase, Warehouse, ExternalLink, Layers, Shield, Calculator, Lock, HardHat, ShieldCheck, MapPin, ArrowUpDown, Receipt, Fuel, FolderOpen
} from 'lucide-react';

// The side nav's icons, shared by the desktop rail (features/salesShell/sideNav/CustomerSidebar.tsx) and
// the phone tab bar (PhoneTabBar.jsx). Pages, sections and who sees what live
// in src/utils/navPins.js; only the icons are here. A page added there needs
// an icon added here.
export const ITEM_ICONS = {
    dashboard: LayoutDashboard,
    customers: User,
    checkin: Clock,
    route_planner: MapIcon,
    holds: Lock,
    permits: HardHat,
    team_files: FolderOpen,
    lost_sales: TrendingDown,
    delivery_schedule: Truck,
    daily_report: ClipboardList,
    pricelist: Tag,
    inventory_analysis: Boxes,
    crossover_sheet: ArrowLeftRight,
    users: Users,
    roles: ShieldCheck,
    locations: MapPin,
    nav_order: ArrowUpDown,
    freight: Receipt,
    fuel_man: Fuel,
    live_inventory: ExternalLink
};

export const SECTION_ICONS = {
    home: LayoutDashboard,
    sales: Briefcase,
    operations: Warehouse,
    products: Layers,
    accounting: Calculator,
    admin: Shield
};
