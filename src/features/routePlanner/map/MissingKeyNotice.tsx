import { MapPin } from 'lucide-react';

/** What shows instead of the map when the build has no Google Maps key. */
const MissingKeyNotice = () => (
    <div className="rpv2-outer">
        <div className="rpv2-empty-shell">
            <MapPin size={40} />
            <h3>The map needs a Google Maps key</h3>
            {import.meta.env.PROD ? (
                <p>
                    <code>VITE_GOOGLE_MAPS_API_KEY</code> isn't set for this deployment. Add it in the
                    hosting dashboard's environment variables, then redeploy — this key is baked in when
                    the app is built, so a restart alone won't pick it up.
                </p>
            ) : (
                <p>
                    Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to <code>.env</code> and restart the dev server.
                    The same key (or <code>GOOGLE_GEOCODING_API_KEY</code>) is what gives customers their
                    coordinates in the first place — see <code>scripts/geocode-customers.js</code>.
                </p>
            )}
        </div>
    </div>
);

export default MissingKeyNotice;
