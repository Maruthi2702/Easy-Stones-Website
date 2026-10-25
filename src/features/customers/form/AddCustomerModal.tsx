import LegacyCustomerModal from './LegacyCustomerModal';
import CustomerForm from './CustomerForm';
import type { CustomerFormProps } from './CustomerForm';
import type { Loose } from '../../../types/records';
import './AddCustomerModal.css';

/*
 * Add and Edit open CustomerForm (the shared form template, design A). The
 * older modal (LegacyCustomerModal) is only reached for the read-only View —
 * the Customers list's eye button — until that view is redesigned too.
 */
export type AddCustomerModalProps = Omit<CustomerFormProps, 'onClose'> & {
    show?: boolean;
    onClose: () => void;
    /** Opens the old read-only View instead of the form (nothing passes one today). */
    viewingCustomer?: Loose | null;
};

const AddCustomerModal = (props: AddCustomerModalProps) => {
    // Add and Edit: the template form. Keyed by customer so opening another
    // one starts fresh instead of keeping the last one's typing.
    if (props.show && !props.viewingCustomer) {
        // A pre-filled new customer (Permits → a contractor's "Create customer") is its own form.
        return <CustomerForm key={props.editingCustomer?._id || (props.prefill ? `prefill-${props.prefill.company}-${props.prefill.notes}` : 'new')} {...props} />;
    }
    return <LegacyCustomerModal {...props} show={Boolean(props.show && props.viewingCustomer)} />;
};

export default AddCustomerModal;
