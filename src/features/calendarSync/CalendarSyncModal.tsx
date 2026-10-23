import { X } from 'lucide-react';
import { calendarFeedUrls } from './calendarSyncApi';
import type { CalendarSync } from './useCalendarSync';

/**
 * Sync Calendar (the dashboard's Planner tab): two-way Google and iCloud sync,
 * and the read-only .ics feed for Apple / Google Calendar. Moved out of
 * SalesPage unchanged (2026-10-23) — same markup and styles. The state is
 * `sync` from useCalendarSync, held by the page so the iCloud form keeps what
 * was typed between opens.
 */
export type CalendarSyncModalProps = {
    sync: CalendarSync;
    /** The signed-in person's id: their feed's address. */
    userId: string | null | undefined;
    onClose: () => void;
};

export default function CalendarSyncModal({ sync, userId, onClose }: CalendarSyncModalProps) {
    const { feed: calendarFeedUrl, webcal: webcalFeedUrl } = calendarFeedUrls(userId);

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '550px', minHeight: '350px' }}>
                <div className="modal-header">
                    <h2>📅 SYNC CALENDAR</h2>
                    <button 
                        type="button" 
                        className="close-btn" 
                        onClick={() => onClose()}
                    >
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body" style={{ padding: '1.5rem', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column', gap: '1.5rem', maxHeight: '550px', overflowY: 'auto' }}>
                    
                    {/* Google Calendar Section */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '1rem', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <h3 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1rem' }}>
                            🔄 Two-Way Google Sync
                        </h3>
                        <p style={{ fontSize: '0.85rem', margin: '0 0 1rem 0', opacity: 0.8, lineHeight: '1.4' }}>
                            Link Google Calendar to sync events both ways: additions in either place automatically update in the other.
                        </p>
                        
                        {sync.google.status.connected ? (
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', background: 'rgba(0,180,0,0.1)', padding: '8px 12px', borderRadius: '4px', border: '1px solid rgba(0,180,0,0.2)' }}>
                                    <span style={{ fontSize: '0.85rem', color: '#8cd48c', fontWeight: 'bold' }}>
                                        Connected: {sync.google.status.email}
                                    </span>
                                    <button 
                                        type="button" 
                                        className="btn-secondary" 
                                        onClick={sync.google.unlink}
                                        style={{ padding: '4px 10px', fontSize: '0.75rem', borderColor: '#ff6b6b', color: '#ff6b6b' }}
                                    >
                                        Disconnect
                                    </button>
                                </div>
                                <button 
                                    type="button" 
                                    className="btn-primary" 
                                    disabled={sync.google.syncing}
                                    onClick={sync.google.sync}
                                    style={{ width: '100%', padding: '8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}
                                >
                                    {sync.google.syncing ? 'Syncing...' : '🔄 Sync Now'}
                                </button>
                            </div>
                        ) : (
                            <button 
                                type="button" 
                                className="btn-primary" 
                                onClick={sync.google.link}
                                style={{ width: '100%', padding: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}
                            >
                                🔗 Link Google Calendar
                            </button>
                        )}
                    </div>

                    {/* Apple iCloud Calendar Section */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '1rem', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <h3 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1rem' }}>
                            🍏 Two-Way Apple iCloud Sync
                        </h3>
                        <p style={{ fontSize: '0.85rem', margin: '0 0 1rem 0', opacity: 0.8, lineHeight: '1.4' }}>
                            Link your iPhone iCloud calendar directly. Syncs events both ways instantly without Google developer accounts!
                        </p>
                        
                        {sync.icloud.status.connected ? (
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', background: 'rgba(0,180,0,0.1)', padding: '8px 12px', borderRadius: '4px', border: '1px solid rgba(0,180,0,0.2)' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        <span style={{ fontSize: '0.85rem', color: '#8cd48c', fontWeight: 'bold' }}>
                                            Linked: {sync.icloud.status.email}
                                        </span>
                                        <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                                            Calendar: {sync.icloud.status.calendarName}
                                        </span>
                                    </div>
                                    <button 
                                        type="button" 
                                        className="btn-secondary" 
                                        onClick={sync.icloud.unlink}
                                        style={{ padding: '4px 10px', fontSize: '0.75rem', borderColor: '#ff6b6b', color: '#ff6b6b' }}
                                    >
                                        Disconnect
                                    </button>
                                </div>
                                <button 
                                    type="button" 
                                    className="btn-primary" 
                                    disabled={sync.icloud.syncing}
                                    onClick={sync.icloud.sync}
                                    style={{ width: '100%', padding: '8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}
                                >
                                    {sync.icloud.syncing ? 'Syncing...' : '🔄 Sync Now'}
                                </button>
                            </div>
                        ) : sync.icloud.calendars.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Select Calendar to Sync:</label>
                                <select 
                                    value={sync.icloud.selectedCalendarUrl} 
                                    onChange={(e) => sync.icloud.setSelectedCalendarUrl(e.target.value)}
                                    style={{
                                        width: '100%',
                                        background: 'rgba(0,0,0,0.3)',
                                        border: '1px solid rgba(255,255,255,0.2)',
                                        borderRadius: '4px',
                                        padding: '8px',
                                        color: '#fff'
                                    }}
                                >
                                    {sync.icloud.calendars.map((cal, idx) => (
                                        <option key={idx} value={cal.url} style={{ background: '#222', color: '#fff' }}>
                                            {cal.name}
                                        </option>
                                    ))}
                                </select>
                                <button 
                                    type="button" 
                                    className="btn-primary" 
                                    disabled={sync.icloud.connecting}
                                    onClick={sync.icloud.linkCalendar}
                                    style={{ padding: '10px', fontWeight: 'bold' }}
                                >
                                    {sync.icloud.connecting ? 'Connecting...' : 'Link Selected Calendar'}
                                </button>
                            </div>
                        ) : (
                            <form onSubmit={sync.icloud.findCalendars} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', opacity: 0.9 }}>Apple ID (iCloud Email):</label>
                                    <input 
                                        type="email" 
                                        required
                                        placeholder="username@icloud.com" 
                                        value={sync.icloud.appleId}
                                        onChange={(e) => sync.icloud.setAppleId(e.target.value)}
                                        style={{
                                            width: '100%',
                                            background: 'rgba(0,0,0,0.2)',
                                            border: '1px solid rgba(255,255,255,0.15)',
                                            borderRadius: '4px',
                                            padding: '8px',
                                            color: '#fff',
                                            fontSize: '0.85rem'
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', opacity: 0.9 }}>iCloud App-Specific Password:</label>
                                    <input 
                                        type="password" 
                                        required
                                        placeholder="xxxx-xxxx-xxxx-xxxx" 
                                        value={sync.icloud.appSpecificPassword}
                                        onChange={(e) => sync.icloud.setAppSpecificPassword(e.target.value)}
                                        style={{
                                            width: '100%',
                                            background: 'rgba(0,0,0,0.2)',
                                            border: '1px solid rgba(255,255,255,0.15)',
                                            borderRadius: '4px',
                                            padding: '8px',
                                            color: '#fff',
                                            fontSize: '0.85rem'
                                        }}
                                    />
                                    <span style={{ fontSize: '0.7rem', opacity: 0.7, marginTop: '2px', display: 'block' }}>
                                        Generate this at <a href="https://appleid.apple.com" target="_blank" rel="noreferrer" style={{ color: 'var(--gold-color, #d4af37)' }}>appleid.apple.com</a>. Do not use your main iCloud login password.
                                    </span>
                                </div>
                                {sync.icloud.error && (
                                    <div style={{ color: '#ff6b6b', fontSize: '0.8rem', fontWeight: 'bold' }}>
                                        ⚠️ {sync.icloud.error}
                                    </div>
                                )}
                                <button 
                                    type="submit" 
                                    className="btn-primary" 
                                    disabled={sync.icloud.connecting}
                                    style={{ padding: '10px', fontWeight: 'bold', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
                                >
                                    {sync.icloud.connecting ? 'Verifying with Apple...' : '🍏 Link iCloud Calendar'}
                                </button>
                            </form>
                        )}
                    </div>

                    <hr style={{ border: 'none', borderBottom: '1px solid rgba(255,255,255,0.1)', margin: '0' }} />

                    {/* One-Way Apple Calendar Section */}
                    <div>
                        <h3 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1rem' }}>
                            📲 Apple Calendar (One-Way Feed)
                        </h3>
                        <p style={{ fontSize: '0.85rem', margin: '0 0 1rem 0', opacity: 0.8, lineHeight: '1.4' }}>
                            Add read-only subscriptions directly to your iPhone/Mac calendar.
                        </p>
                        
                        <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '1rem', marginBottom: '1rem', border: '1px solid rgba(255,255,255,0.1)' }}>
                            <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--gold-color, #d4af37)', fontSize: '0.85rem' }}>Your Secure Subscription Link:</h4>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <input 
                                    type="text" 
                                    readOnly 
                                    value={calendarFeedUrl} 
                                    style={{
                                        flex: 1,
                                        background: 'rgba(0,0,0,0.3)',
                                        border: '1px solid rgba(255,255,255,0.2)',
                                        borderRadius: '4px',
                                        padding: '8px 12px',
                                        color: '#fff',
                                        fontSize: '0.8rem',
                                        fontFamily: 'monospace'
                                    }}
                                />
                                <button 
                                    type="button" 
                                    className="btn-secondary" 
                                    onClick={() => {
                                        navigator.clipboard.writeText(calendarFeedUrl);
                                        alert('Calendar link copied to clipboard!');
                                    }}
                                    style={{ padding: '8px 16px', fontSize: '0.8rem' }}
                                >
                                    Copy
                                </button>
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <a 
                                href={webcalFeedUrl}
                                className="btn-primary" 
                                style={{ 
                                    textAlign: 'center', 
                                    textDecoration: 'none', 
                                    padding: '10px', 
                                    fontWeight: 'bold',
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}
                            >
                                📲 Subscribe in Apple Calendar (Mac/iPhone)
                            </a>
                            
                            <div style={{ fontSize: '0.8rem', opacity: 0.8, lineHeight: '1.4' }}>
                                <strong>Google Calendar Instructions:</strong>
                                <ol style={{ margin: '4px 0 0 16px', paddingLeft: 0 }}>
                                    <li>Open <a href="https://calendar.google.com" target="_blank" rel="noreferrer" style={{ color: 'var(--gold-color, #d4af37)' }}>Google Calendar</a> on a desktop browser.</li>
                                    <li>On the left side next to "Other calendars", click <strong>+</strong> &rarr; <strong>From URL</strong>.</li>
                                    <li>Paste the copied link and click <strong>Add calendar</strong>.</li>
                                </ol>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}
