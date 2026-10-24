import { Download, Search } from 'lucide-react';
import LocationFilter from '../../../components/shared/LocationFilter';
import type { Loose } from '../../../types/records';
import ClientResources from './ClientResources';
import type { ClientResourcesProps } from './ClientResources';
import TeamFilesControls from './TeamFilesControls';
import type { TeamFilesControlsProps } from './TeamFilesControls';
import TeamFilesList from './TeamFilesList';
import type { TeamFilesListProps } from './TeamFilesList';

export type ResourcesPanelProps = {
    subTab: 'client' | 'team';
    onSubTabChange: (tab: 'client' | 'team') => void;
    locationOptions: string[];
    location: string;
    onLocationChange: (value: string) => void;
    currentUser: Loose | null;
    searchTerm: string;
    onSearchChange: (value: string) => void;
    onExport: () => void;
    client: ClientResourcesProps;
    teamControls: TeamFilesControlsProps;
    teamList: TeamFilesListProps;
};

/** Dashboard → Resources: Client Updates (resources placed at customers) and Team Files (shared folders). */
export default function ResourcesPanel({
    subTab: activeResourceSubTab, onSubTabChange, locationOptions, location, onLocationChange, currentUser, searchTerm, onSearchChange, onExport,
    client, teamControls, teamList
}: ResourcesPanelProps) {
    return (
        <div className="visits-table-section">
            <div className="section-header">
                <h2>Resources</h2>
                {activeResourceSubTab === 'client' && (
                    <div className="table-controls">
        <LocationFilter
            options={locationOptions}
            value={location}
            onChange={onLocationChange}
            user={currentUser}
        />
        <button className="export-btn" onClick={onExport}>
            <Download size={18} /> Excel
        </button>
        <div className="table-search">
            <Search className="search-icon" size={18} />
            <input
                type="text"
                placeholder="Search resources..."
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
            />
        </div>
                    </div>
                )}
                {activeResourceSubTab === 'team' && <TeamFilesControls {...teamControls} />}
            </div>

            <div className="dashboard-sub-tabs">
                <button
                    className={`sub-tab-btn ${activeResourceSubTab === 'client' ? 'active' : ''}`}
                    onClick={() => onSubTabChange('client')}
                >
                    Client Updates
                </button>
                <button
                    className={`sub-tab-btn ${activeResourceSubTab === 'team' ? 'active' : ''}`}
                    onClick={() => onSubTabChange('team')}
                >
                    Team Files
                </button>
            </div>

            {activeResourceSubTab === 'client' && <ClientResources {...client} />}
            {activeResourceSubTab === 'team' && <TeamFilesList {...teamList} />}
        </div>
    );
}
