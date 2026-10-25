// The shared controls still use JavaScript. Their inferred signatures mark
// omitted props as required; these adapters describe the existing optional
// props without changing shared controls outside this migration.
import type { ComponentProps, ComponentType, ElementType } from 'react';
import CustomSelectComponent from '../components/shared/CustomSelect';
import LocationFilterComponent from '../components/shared/LocationFilter';
import PaginationComponent from '../components/shared/Pagination';
import { DatePicker as DatePickerComponent } from '../components/shared/calendar/Calendar';

type WithOptional<C extends ElementType, K extends keyof ComponentProps<C>> =
  Omit<ComponentProps<C>, K> & Partial<Pick<ComponentProps<C>, K>>;

export const CustomSelect = CustomSelectComponent as ComponentType<WithOptional<typeof CustomSelectComponent,
  'menuWidth' | 'triggerAriaLabel' | 'triggerClassName' | 'triggerContent' | 'triggerTitle'>>;
export const LocationFilter = LocationFilterComponent as ComponentType<WithOptional<typeof LocationFilterComponent,
  'onChange' | 'value'>>;
export const Pagination = PaginationComponent as ComponentType<WithOptional<typeof PaginationComponent, 'children'>>;
export const DatePicker = DatePickerComponent as ComponentType<WithOptional<typeof DatePickerComponent,
  'className' | 'disabled' | 'error' | 'icon' | 'id' | 'onBlur' | 'placeholder' | 'shortcuts' | 'status' | 'today' | 'triggerClassName'>>;
