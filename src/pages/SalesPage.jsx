import React, { useState, useEffect, useRef } from 'react';
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api';
import { Navigation } from 'lucide-react';
import './SalesPage.css';

const SalesPage = () => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    const [userLocation, setUserLocation] = useState(null);
    const [locationError, setLocationError] = useState(null);
    const [savedMarkers, setSavedMarkers] = useState([]);
    const mapRef = useRef(null);

    const { isLoaded, loadError } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: apiKey
    });

    // Load saved markers from localStorage on mount
    useEffect(() => {
        const stored = localStorage.getItem('mapMarkers');
        if (stored) {
            try {
                setSavedMarkers(JSON.parse(stored));
            } catch (error) {
                console.error('Error loading markers:', error);
            }
        }
    }, []);

    // Get user's location on component mount
    useEffect(() => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    setUserLocation({
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    });
                },
                (error) => {
                    console.error('Error getting location:', error);
                    setLocationError(error.message);
                    // Fallback to Seattle if location access is denied
                    setUserLocation({
                        lat: 47.6062,
                        lng: -122.3321
                    });
                }
            );
        } else {
            setLocationError('Geolocation is not supported by your browser');
            // Fallback to Seattle
            setUserLocation({
                lat: 47.6062,
                lng: -122.3321
            });
        }
    }, []);

    const handleMapClick = (event) => {
        const newMarker = {
            id: Date.now(),
            lat: event.latLng.lat(),
            lng: event.latLng.lng(),
            title: `Point ${savedMarkers.length + 1}`
        };

        const updatedMarkers = [...savedMarkers, newMarker];
        setSavedMarkers(updatedMarkers);
        localStorage.setItem('mapMarkers', JSON.stringify(updatedMarkers));
    };

    const handleRemoveMarker = (markerId) => {
        const updatedMarkers = savedMarkers.filter(m => m.id !== markerId);
        setSavedMarkers(updatedMarkers);
        localStorage.setItem('mapMarkers', JSON.stringify(updatedMarkers));
    };

    const handleClearAllMarkers = () => {
        if (window.confirm('Are you sure you want to clear all markers?')) {
            setSavedMarkers([]);
            localStorage.removeItem('mapMarkers');
        }
    };

    const handleRecenter = () => {
        if (mapRef.current && userLocation) {
            mapRef.current.panTo(userLocation);
            mapRef.current.setZoom(12);
        }
    };

    const onLoad = (map) => {
        mapRef.current = map;
    };

    if (loadError) {
        return (
            <div className="sales-page">
                <div className="sales-header">
                    <h1>Google Maps</h1>
                </div>
                <div className="container" style={{ padding: '2rem', textAlign: 'center' }}>
                    <p style={{ color: '#ef4444' }}>Error loading Google Maps: {loadError.message}</p>
                </div>
            </div>
        );
    }

    if (!isLoaded || !userLocation) {
        return (
            <div className="sales-page">
                <div className="sales-header">
                    <h1>Google Maps</h1>
                </div>
                <div className="container" style={{ padding: '2rem', textAlign: 'center' }}>
                    <p>Loading map and detecting your location...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="sales-page">
            <div className="sales-header">
                <h1>Google Maps</h1>
                <p>
                    {locationError
                        ? `Using default location (${locationError})`
                        : 'Centered on your current location'}
                </p>
            </div>
            <div className="container" style={{ height: 'calc(100vh - 200px)', padding: '2rem', position: 'relative' }}>
                {/* Marker Controls */}
                <div style={{
                    position: 'absolute',
                    top: '3rem',
                    left: '3rem',
                    zIndex: 10,
                    backgroundColor: '#1f2937',
                    border: '2px solid #4ade80',
                    borderRadius: '8px',
                    padding: '1rem',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
                    color: 'white',
                    minWidth: '200px'
                }}>
                    <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: '600' }}>
                        Saved Points ({savedMarkers.length})
                    </h3>
                    <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.75rem', color: '#9ca3af' }}>
                        Click on the map to add markers
                    </p>
                    {savedMarkers.length > 0 && (
                        <button
                            onClick={handleClearAllMarkers}
                            style={{
                                width: '100%',
                                backgroundColor: '#ef4444',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                padding: '0.5rem',
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                                fontWeight: '500'
                            }}
                        >
                            Clear All
                        </button>
                    )}
                </div>

                {/* Recenter Button */}
                <button
                    onClick={handleRecenter}
                    style={{
                        position: 'absolute',
                        top: '3rem',
                        right: '3rem',
                        zIndex: 10,
                        backgroundColor: '#1f2937',
                        color: 'white',
                        border: '2px solid #4ade80',
                        borderRadius: '8px',
                        padding: '0.75rem 1rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontSize: '0.875rem',
                        fontWeight: '500',
                        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
                        transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#374151';
                        e.currentTarget.style.transform = 'scale(1.05)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '#1f2937';
                        e.currentTarget.style.transform = 'scale(1)';
                    }}
                >
                    <Navigation size={18} />
                    My Location
                </button>

                <GoogleMap
                    mapContainerStyle={{
                        width: '100%',
                        height: '100%',
                        borderRadius: '12px'
                    }}
                    center={userLocation}
                    zoom={12}
                    onLoad={onLoad}
                    onClick={handleMapClick}
                    options={{
                        styles: [
                            {
                                featureType: 'all',
                                elementType: 'geometry',
                                stylers: [{ color: '#242f3e' }]
                            },
                            {
                                featureType: 'all',
                                elementType: 'labels.text.stroke',
                                stylers: [{ color: '#242f3e' }]
                            },
                            {
                                featureType: 'all',
                                elementType: 'labels.text.fill',
                                stylers: [{ color: '#746855' }]
                            },
                            {
                                featureType: 'water',
                                elementType: 'geometry',
                                stylers: [{ color: '#17263c' }]
                            }
                        ]
                    }}
                >
                    {/* Blue dot marker for user's location */}
                    <Marker
                        position={userLocation}
                        icon={{
                            path: window.google.maps.SymbolPath.CIRCLE,
                            scale: 8,
                            fillColor: '#4285F4',
                            fillOpacity: 1,
                            strokeColor: '#ffffff',
                            strokeWeight: 3
                        }}
                    />

                    {/* Saved markers */}
                    {savedMarkers.map((marker) => (
                        <Marker
                            key={marker.id}
                            position={{ lat: marker.lat, lng: marker.lng }}
                            title={marker.title}
                            onClick={() => handleRemoveMarker(marker.id)}
                            icon={{
                                path: window.google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
                                scale: 6,
                                fillColor: '#ef4444',
                                fillOpacity: 1,
                                strokeColor: '#ffffff',
                                strokeWeight: 2,
                                rotation: 180
                            }}
                        />
                    ))}
                </GoogleMap>
            </div>
        </div>
    );
};

export default SalesPage;
