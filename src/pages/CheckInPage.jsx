import React, { useState, useEffect } from 'react';
import { 
  User, Phone, Mail, MapPin, Building, 
  UserCheck, Send, Loader2, CheckCircle2, Clock
} from 'lucide-react';
import { API_URL } from '../config/api';
import './CheckInPage.css';

const CheckInPage = () => {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    fabricatorCompany: '',
    fabricatorName: '',
    fabricatorPhone: ''
  });

  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);
  const [recentCheckIns, setRecentCheckIns] = useState([]);
  const [fetchingCheckIns, setFetchingCheckIns] = useState(false);

  useEffect(() => {
    fetchRecentCheckIns();
    // Auto-refresh the list every 30 seconds
    const interval = setInterval(fetchRecentCheckIns, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchRecentCheckIns = async () => {
    setFetchingCheckIns(true);
    try {
      const response = await fetch(`${API_URL}/api/checkin`);
      if (response.ok) {
        const data = await response.json();
        setRecentCheckIns(data);
      }
    } catch (err) {
      console.error('Error fetching check-ins:', err);
    } finally {
      setFetchingCheckIns(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.phone) {
      setError('Name and Phone Number are mandatory');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        setSubmitted(true);
        fetchRecentCheckIns();
        // Reset form after 3 seconds success message
        setTimeout(() => {
          setSubmitted(false);
          setFormData({
            name: '',
            phone: '',
            email: '',
            fabricatorCompany: '',
            fabricatorName: '',
            fabricatorPhone: ''
          });
        }, 5000);
      } else {
        const data = await response.json();
        setError(data.message || 'Check-in failed');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="checkin-container">
      <div className="checkin-header">
        <div className="logo-section">
          <h1>Easy Stones</h1>
          <p>Visitor Check-in</p>
        </div>
      </div>

      <div className="checkin-card">
        {submitted ? (
          <div className="success-message">
            <CheckCircle2 size={64} className="success-icon" />
            <h2>Welcome!</h2>
            <p>Thank you for checking in, <strong>{formData.name}</strong>.</p>
            <p>Someone will be with you shortly.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="checkin-form">
            <div className="form-section">
              <h3>Personal Information</h3>
              <div className="input-group">
                <div className="input-field">
                  <label><User size={16} /> Name <span className="required">*</span></label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="Enter your full name"
                    required
                  />
                </div>
                <div className="input-field">
                  <label><Phone size={16} /> Phone Number <span className="required">*</span></label>
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    placeholder="(555) 000-0000"
                    required
                  />
                </div>
              </div>

              <div className="input-group">
                <div className="input-field">
                  <label><Mail size={16} /> Email Address</label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="example@email.com"
                  />
                </div>
              </div>
            </div>

            <div className="form-section">
              <h3>Fabricator / Contractor Details</h3>
              <div className="input-group">
                <div className="input-field">
                  <label><Building size={16} /> Company Name</label>
                  <input
                    type="text"
                    name="fabricatorCompany"
                    value={formData.fabricatorCompany}
                    onChange={handleChange}
                    placeholder="Enter company name"
                  />
                </div>
                <div className="input-field">
                  <label><UserCheck size={16} /> Contact Person</label>
                  <input
                    type="text"
                    name="fabricatorName"
                    value={formData.fabricatorName}
                    onChange={handleChange}
                    placeholder="Who are you working with?"
                  />
                </div>
              </div>
              <div className="input-field">
                <label><Phone size={16} /> Fabricator Phone</label>
                <input
                  type="tel"
                  name="fabricatorPhone"
                  value={formData.fabricatorPhone}
                  onChange={handleChange}
                  placeholder="Fabricator's phone number"
                />
              </div>
            </div>

            {error && <div className="error-message">{error}</div>}

            <button type="submit" className="submit-btn" disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <><Send size={18} /> Check In Now</>}
            </button>
          </form>
        )}
      </div>

      <div className="recent-checkins-section">
        <div className="section-header">
          <Clock size={20} />
          <h2>Recent Visitors Today</h2>
          {fetchingCheckIns && <Loader2 size={16} className="animate-spin" />}
        </div>
        
        <div className="checkins-list">
          {recentCheckIns.length === 0 ? (
            <p className="no-data">No visitors recorded today.</p>
          ) : (
            <div className="table-responsive">
              <table className="checkin-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Name</th>
                    <th>Phone Number</th>
                    <th>Fabricator/Contractor Company</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCheckIns.map(checkIn => (
                    <tr key={checkIn._id}>
                      <td>
                        <div className="date-cell">
                          <span className="date-text">{formatDate(checkIn.createdAt)}</span>
                          <span className="time-text">{formatTime(checkIn.createdAt)}</span>
                        </div>
                      </td>
                      <td className="name-cell">{checkIn.name}</td>
                      <td>{checkIn.phone}</td>
                      <td>
                        <span className={`company-badge ${!checkIn.fabricatorCompany ? 'none' : ''}`}>
                          {checkIn.fabricatorCompany || 'None'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CheckInPage;
