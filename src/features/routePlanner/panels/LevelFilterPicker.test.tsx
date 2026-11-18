// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import LevelFilterPicker, { levelSummary } from './LevelFilterPicker';

afterEach(cleanup);

describe('levelSummary', () => {
  it('says what is ticked', () => {
    expect(levelSummary({})).toBe('All levels');
    expect(levelSummary({ 'Level - 1': false })).toBe('3 of 4 levels');
    expect(levelSummary({ 'Level - 1': false, 'Level - 2': false, 'Level - 3': false })).toBe('Level 4');
    expect(levelSummary({ 'Level - 1': false, 'Level - 2': false, 'Level - 3': false, 'Level - 4': false })).toBe('No levels');
  });
});

describe('LevelFilterPicker', () => {
  it('lists the four levels with their counts and reports ticks, All and None', () => {
    const onToggle = vi.fn(); const onAll = vi.fn(); const onNone = vi.fn();
    render(<LevelFilterPicker active={{ 'Level - 4': false }} counts={{ 'Level - 1': 48, 'Level - 3': 372 }} onToggle={onToggle} onAll={onAll} onNone={onNone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Level' }));
    const rows = screen.getAllByRole('checkbox');
    expect(rows.map(r => r.textContent)).toEqual(['Level 148', 'Level 20', 'Level 3372', 'Level 40']);
    expect(rows.map(r => r.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true', 'false']);
    fireEvent.click(rows[1]);
    expect(onToggle).toHaveBeenCalledWith('Level - 2');
    fireEvent.click(screen.getByText('All'));
    fireEvent.click(screen.getByText('None'));
    expect(onAll).toHaveBeenCalled();
    expect(onNone).toHaveBeenCalled();
  });
});
