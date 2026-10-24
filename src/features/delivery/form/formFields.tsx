import { FormField, FormPicker } from '../../../components/shared/form/FormControls';
import { describedBy } from '../../../components/shared/form/formFocus';
import LocationPicker from '../../../components/shared/form/LocationPicker';
import { DatePicker } from '../../../components/shared/calendar/Calendar';
import type { DeliveryFormValues } from '../../../utils/deliveryForm';
import type { CurrentUser } from '../../../types/records';

export type FieldName = keyof DeliveryFormValues;
type TextOpts = {
    required?: boolean; placeholder?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']; asTyped?: boolean;
    error?: string; status?: React.ReactNode; value?: string; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void; onBlur?: () => void;
};
type DateOpts = { required?: boolean; error?: string; status?: React.ReactNode; onChange?: (iso: string) => void; onBlur?: () => void };
type PickerOpts = { required?: boolean; placeholder?: string; onChange?: (value: string) => void; value?: string; error?: string; status?: React.ReactNode };

type Args = {
    values: DeliveryFormValues;
    set: (patch: Partial<DeliveryFormValues>) => void;
    /** A field's error once it's been touched or the form submitted, else ''. */
    shown: (field: string) => string;
    locationsList: string[];
    currentUser: CurrentUser | null;
};

/**
 * The Delivery form's field builders — a text box, a day, a picker and a
 * branch — each bound to the form's values. Built every render, as before.
 */
export function fieldHelpers({ values, set, shown, locationsList, currentUser }: Args) {
        const text = (name: FieldName, label: string, { required = false, placeholder, inputMode, asTyped = false, error, status, value, onChange, onBlur }: TextOpts = {}) => {
            const id = `df-${name}`;
            return (
                <FormField name={name} id={id} label={label} required={required} error={error} status={status}>
                    <input
                        id={id}
                        className={`fm-input${asTyped ? ' no-capitalize' : ''}`}
                        type="text"
                        inputMode={inputMode}
                        value={value ?? (values[name] as string) ?? ''}
                        placeholder={placeholder}
                        autoComplete="off"
                        autoCapitalize={asTyped ? undefined : 'words'}
                        onChange={onChange || ((e) => set({ [name]: e.target.value } as Partial<DeliveryFormValues>))}
                        onBlur={onBlur}
                        {...describedBy(id, error, status)}
                    />
                </FormField>
            );
        };
        // A day: the shared calendar (shared/calendar). Clearable when optional —
        // a Pending delivery has no date yet.
        const dateInput = (name: FieldName, label: string, { required = false, error, status, onChange, onBlur }: DateOpts = {}) => {
            const id = `df-${name}`;
            return (
                <FormField name={name} id={id} label={label} required={required} error={error} status={status}>
                    <DatePicker
                        id={id}
                        value={(values[name] as string) || ''}
                        onChange={onChange || ((v: string) => set({ [name]: v } as Partial<DeliveryFormValues>))}
                        onBlur={onBlur}
                        error={error}
                        status={status}
                        clearable={!required}
                        sheetTitle={label}
                    />
                </FormField>
            );
        };
        const picker = (name: FieldName, label: string, options: { value: string; label: string; description?: string; disabled?: boolean }[], { required = false, placeholder, onChange, value, error, status }: PickerOpts = {}) => (
            <FormField name={name} id={`df-${name}`} label={label} required={required} error={error} status={status}>
                <FormPicker
                    id={`df-${name}`}
                    value={value ?? (values[name] as string)}
                    onChange={onChange || ((v: string) => set({ [name]: v } as Partial<DeliveryFormValues>))}
                    options={options}
                    placeholder={placeholder}
                    sheetTitle={label}
                    error={error}
                />
            </FormField>
        );
        // A transfer's From / To: the shared location dropdown (home first, then
        // A–Z); a branch already saved on the ticket stays listed.
        const branchPicker = (name: FieldName, label: string) => (
            <FormField name={name} id={`df-${name}`} label={label} required error={shown(name)}>
                <LocationPicker
                    id={`df-${name}`}
                    value={(values[name] as string) || ''}
                    onChange={(v: string) => set({ [name]: v } as Partial<DeliveryFormValues>)}
                    options={locationsList || []}
                    user={currentUser}
                    placeholder="Pick a branch"
                    sheetTitle={label}
                    error={shown(name)}
                />
            </FormField>
        );

    return { text, dateInput, picker, branchPicker };
}
