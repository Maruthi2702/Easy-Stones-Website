// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PeopleField from './PeopleField';
import { togglePerson } from '../dashboardPeople';
import type { PersonOption } from '../../../api/myTeam';

const options: PersonOption[] = [
    { value: 'me1', id: 'me1', label: 'Krish', location: 'Seattle', inactive: false },
    { value: 'jesus', id: 'jesus', label: 'Jesus B.', location: 'Seattle', inactive: false },
    { value: 'bart', id: 'bart', label: 'Bart A.', location: 'Kent', inactive: true }
];
let phone = false;
beforeEach(() => {
    phone = false;
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: phone && query === '(max-width: 639px)', media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function PeoplePicker() {
    const [value, setValue] = useState(['me1']);
    return <><PeopleField options={options} value={value} me="me1" onChange={setValue}
        onToggle={id => setValue(current => togglePerson(current, id, 'me1', options.map(option => option.value)))} />
        <output data-testid="people-value">{JSON.stringify(value)}</output></>;
}
const checked = (name: RegExp | string) => screen.getByRole('checkbox', { name }).getAttribute('aria-checked');
const chooseTeam = () => { fireEvent.click(screen.getByLabelText('People')); fireEvent.click(screen.getByRole('checkbox', { name: 'My team' })); };

describe.each([false, true])('People selection on phone=%s', isPhone => {
    it('checks all individual names for My team and restores Me on request', () => {
        phone = isPhone;
        render(<PeoplePicker />); chooseTeam();
        expect(checked('My team')).toBe('true');
        for (const name of [/Krish/, 'Jesus B.', /Bart A\./]) expect(checked(name)).toBe('true');
        expect(screen.getByTestId('people-value').textContent).toBe('[]');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Me' }));
        expect(checked('Me')).toBe('true');
        expect(checked(/Krish/)).toBe('true');
        expect(checked('Jesus B.')).toBe('false');
        expect(checked(/Bart A\./)).toBe('false');
    });

    it('unchecks one teammate without clearing everyone else', () => {
        phone = isPhone;
        render(<PeoplePicker />); chooseTeam();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Jesus B.' }));
        expect(checked('Jesus B.')).toBe('false');
        expect(checked(/Krish/)).toBe('true');
        expect(checked(/Bart A\./)).toBe('true');
        expect(checked('My team')).toBe('false');
        expect(JSON.parse(screen.getByTestId('people-value').textContent!)).toEqual(['me1', 'bart']);
    });

    it('keeps hidden teammates selected when unchecking a search result', () => {
        phone = isPhone;
        render(<PeoplePicker />); chooseTeam();
        fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'bart' } });
        expect(checked(/Bart A\./)).toBe('true');
        fireEvent.click(screen.getByRole('checkbox', { name: /Bart A\./ }));
        fireEvent.change(screen.getByLabelText('Search people'), { target: { value: '' } });
        expect(checked(/Bart A\./)).toBe('false');
        expect(checked(/Krish/)).toBe('true');
        expect(checked('Jesus B.')).toBe('true');
    });
});
