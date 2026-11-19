import { WHERE_FILTERS } from '../../utils/visitLocation';
import type { WhereFilter } from '../../utils/visitLocation';
import './Location.css';

/** The Visits Filters panel's "Where logged" field: which marks to list. Only for people who may see them. */
export default function WhereLoggedField({ value, onChange }: { value: WhereFilter; onChange: (value: WhereFilter) => void }) {
    return (
        <div className="lf-group">
            <span className="lf-group-label" id="where-logged-label">Where logged</span>
            <div className="loc-where" role="radiogroup" aria-labelledby="where-logged-label">
                {WHERE_FILTERS.map((option) => (
                    <button
                        key={option.value} type="button" role="radio" aria-checked={value === option.value}
                        className={`loc-where-opt${value === option.value ? ' is-on' : ''} loc-where-opt--${option.value}`}
                        onClick={() => onChange(option.value)}
                    >{option.label}</button>
                ))}
            </div>
        </div>
    );
}
