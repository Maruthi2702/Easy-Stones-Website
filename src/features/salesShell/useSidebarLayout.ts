import { useEffect, useState } from 'react';

/**
 * The side nav's layout. On desktop it is always docked (it collapses to its
 * section rail instead of hiding — sideNav/CustomerSidebar.tsx); at 1024px and below
 * it's a drawer opened by each tab's SidebarToggleButton (`isMobile`). Moved
 * out of SalesPage unchanged (2026-10-24).
 */
export function useSidebarLayout() {
    const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 1024);

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth <= 1024);
            if (window.innerWidth > 1024) {
                setIsSidebarOpen(true);
            }
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return { isSidebarOpen, setIsSidebarOpen, isMobile };
}
