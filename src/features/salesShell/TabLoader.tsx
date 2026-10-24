import { Loader } from 'lucide-react';

/**
 * One small, inline fallback rather than a full-page spinner — App.jsx's
 * <PageLoader/> is sized for a blank page, and using it here would flash the
 * whole dashboard chrome (sidebar, header) to nothing while a single tab's
 * chunk loads.
 */
export default function TabLoader() {
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
            <Loader size={28} className="animate-spin" style={{ color: '#d4af37' }} />
        </div>
    );
}
