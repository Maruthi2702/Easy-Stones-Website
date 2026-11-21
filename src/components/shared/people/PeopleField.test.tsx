// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PeopleField from './PeopleField';
import { togglePerson } from '../../../utils/peopleSelection';
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
        onToggle={id => setValue(current => togglePerson(current, id, 'me1', options.map(option => option.value)))}
        onBranch={() => {}} />
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

describe('branch All / None', () => {
    it('shows a count and All / None per branch when there is more than one, and hands back the branch ids', () => {
        const onBranch = vi.fn();
        render(<PeopleField options={options} value={['me1']} me="me1" onChange={() => {}} onToggle={() => {}} onBranch={onBranch} />);
        fireEvent.click(screen.getByLabelText('People'));
        expect(screen.getByText(/1 of 2/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Tick everyone in Seattle' }));
        expect(onBranch).toHaveBeenLastCalledWith(['jesus', 'me1'], true);
        fireEvent.click(screen.getByRole('button', { name: 'Untick everyone in Kent' }));
        expect(onBranch).toHaveBeenLastCalledWith(['bart'], false);
    });

    it('leaves out All / None when the viewer sees only one branch', () => {
        render(<PeopleField options={options.slice(0, 2)} value={['me1']} me="me1" onChange={() => {}} onToggle={() => {}} onBranch={() => {}} />);
        fireEvent.click(screen.getByLabelText('People'));
        expect(screen.queryByRole('button', { name: /Tick everyone/ })).toBeNull();
    });

    it('names a whole branch on the closed field', () => {
        render(<PeopleField options={options} value={['me1', 'jesus']} me="me1" onChange={() => {}} onToggle={() => {}} onBranch={() => {}} />);
        expect(screen.getByText('Seattle (all 2)')).toBeTruthy();
    });
});
