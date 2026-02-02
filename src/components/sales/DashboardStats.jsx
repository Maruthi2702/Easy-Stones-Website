import React from 'react';
import { UserPlus, FolderPlus, Clock, Calendar } from 'lucide-react';

const DashboardStats = ({
    stats,
    statsLoading,
    dashboardTimeRange,
    setDashboardTimeRange,
    activeDashboardTab,
    setActiveDashboardTab,

    todayScheduleCount
}) => {
    const currentStats = statsLoading ? { visits: '...', followUp: '...', resources: '...' } : stats;

    const timeLabels = {
        '1day': 'Today',
        '7days': 'Last 7 Days',
        '30days': 'Last 30 Days',
        'year': 'Year-to-date',
        'all': 'All'
    };

    const timeLabel = {
        '1day': 'Today',
        '7days': 'Last 7 Days',
        '30days': 'Last 30 Days',
        'year': 'Year-to-date',
        'all': 'All Time'
    }[dashboardTimeRange];

    return (
        <>
            {/* Time Filters */}
            <div className="time-range-filters">
                {['1day', '7days', '30days', 'year', 'all'].map(range => (
                    <button
                        key={range}
                        className={`time-filter-btn ${dashboardTimeRange === range ? 'active' : ''}`}
                        onClick={() => setDashboardTimeRange(range)}
                    >
                        {timeLabels[range]}
                    </button>
                ))}
            </div>

            {/* Stats Grid */}
            <div className="stats-grid">
                <div
                    className={`stat-card ${activeDashboardTab === 'visits' ? 'active-tab' : ''}`}
                    onClick={() => setActiveDashboardTab('visits')}
                    style={{ cursor: 'pointer' }}
                >
                    <div className="stat-icon-wrapper">
                        <UserPlus size={20} />
                    </div>
                    <div className="stat-info">
                        <div className="stat-title">SALES VISITS</div>
                    </div>
                    <div className="stat-value">{statsLoading ? '...' : currentStats.visits}</div>
                    <div className="stat-footer">{timeLabel}</div>
                </div>

                <div
                    className={`stat-card ${activeDashboardTab === 'resources' ? 'active-tab' : ''}`}
                    onClick={() => setActiveDashboardTab('resources')}
                    style={{ cursor: 'pointer' }}
                >
                    <div className="stat-icon-wrapper">
                        <FolderPlus size={20} />
                    </div>
                    <div className="stat-info">
                        <div className="stat-title">RESOURCES</div>
                        <div className="stat-desc">(Assignment & Updates)</div>
                    </div>
                    <div className="stat-value">{statsLoading ? '...' : currentStats.resources}</div>
                    <div className="stat-footer">{timeLabel}</div>
                </div>

                <div
                    className={`stat-card ${activeDashboardTab === 'followups' ? 'active-tab' : ''}`}
                    onClick={() => setActiveDashboardTab('followups')}
                    style={{ cursor: 'pointer' }}
                >
                    <div className="stat-icon-wrapper">
                        <Clock size={20} />
                    </div>
                    <div className="stat-info">
                        <div className="stat-title">FOLLOW-UP</div>
                    </div>
                    <div className="stat-value">{statsLoading ? '...' : currentStats.followUp}</div>
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
                    <div className="stat-info">
                        <div className="stat-title">CALENDAR</div>
                    </div>
                    <div className="stat-value">{statsLoading ? '...' : todayScheduleCount}</div>
                    <div className="stat-footer">Schedule</div>
                </div>

            </div>
        </>
    );
};

export default DashboardStats;
