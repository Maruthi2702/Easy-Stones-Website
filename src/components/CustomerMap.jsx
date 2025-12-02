import React from 'react';
import { GoogleMap, LoadScript, Marker, InfoWindow } from '@react-google-maps/api';
import { MapPin } from 'lucide-react';

const containerStyle = {
    width: '100%',
    height: '100%',
    borderRadius: '12px'
};

const defaultCenter = {
    lat: 37.7749, // San Francisco
    lng: -122.4194
};

const CustomerMap = ({ customers, onCustomerClick, selectedCustomer, onCloseInfo }) => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

    // Calculate map center based on customers with coordinates
    const getMapCenter = () => {
        const customersWithCoords = customers.filter(c => c.coordinates?.lat && c.coordinates?.lng);

        if (customersWithCoords.length === 0) {
            return defaultCenter;
        }

        const avgLat = customersWithCoords.reduce((sum, c) => sum + c.coordinates.lat, 0) / customersWithCoords.length;
        const avgLng = customersWithCoords.reduce((sum, c) => sum + c.coordinates.lng, 0) / customersWithCoords.length;

        return { lat: avgLat, lng: avgLng };
    };

    // If no API key, show placeholder
    if (!apiKey) {
        return (
            <div className="map-placeholder">
                <MapPin size={48} />
                <h3>Google Maps Not Configured</h3>
                <p>Add your Google Maps API key to .env file:</p>
                <code>VITE_GOOGLE_MAPS_API_KEY=your_api_key_here</code>
                <a
                    href="https://developers.google.com/maps/documentation/javascript/get-api-key"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary"
                    style={{ marginTop: '1rem' }}
                >
                    Get API Key
                </a>
            </div>
        );
    }

    const getStatusColor = (status) => {
        switch (status) {
            case 'active': return '#4ade80';
            case 'prospect': return '#fbbf24';
            case 'inactive': return '#94a3b8';
            default: return '#94a3b8';
        }
    };

    return (
        <LoadScript googleMapsApiKey={apiKey}>
            <GoogleMap
                mapContainerStyle={containerStyle}
                center={getMapCenter()}
                zoom={10}
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
                {customers
                    .filter(customer => customer.coordinates?.lat && customer.coordinates?.lng)
                    .map(customer => (
                        <Marker
                            key={customer._id}
                            position={{ lat: customer.coordinates.lat, lng: customer.coordinates.lng }}
                            onClick={() => onCustomerClick(customer)}
                            icon={{
                                path: window.google.maps.SymbolPath.CIRCLE,
                                scale: 10,
                                fillColor: getStatusColor(customer.status),
                                fillOpacity: 1,
                                strokeColor: '#ffffff',
                                strokeWeight: 2
                            }}
                        />
                    ))}

                {selectedCustomer && selectedCustomer.coordinates?.lat && selectedCustomer.coordinates?.lng && (
                    <InfoWindow
                        position={{ lat: selectedCustomer.coordinates.lat, lng: selectedCustomer.coordinates.lng }}
                        onCloseClick={onCloseInfo}
                    >
                        <div className="map-info-window">
                            <h4>{selectedCustomer.customerName}</h4>
                            {selectedCustomer.company && <p className="company">{selectedCustomer.company}</p>}
                            <p className="address">{selectedCustomer.address}</p>
                            {selectedCustomer.phone && <p className="phone">{selectedCustomer.phone}</p>}
                            <span
                                className="status-badge"
                                style={{ backgroundColor: getStatusColor(selectedCustomer.status) }}
                            >
                                {selectedCustomer.status}
                            </span>
                        </div>
                    </InfoWindow>
                )}
            </GoogleMap>
        </LoadScript>
    );
};

export default CustomerMap;
