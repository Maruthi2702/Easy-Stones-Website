// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from './HomePage';

vi.mock('../context/ProductContext', () => ({ useProducts: () => ({ products: [{ id: 1, name: 'Lincoln' }], loading: false }) }));
vi.mock('../components/HeroCarousel', () => ({ default: () => <div>Featured colors</div> }));
vi.mock('../components/CategoryNav', () => ({ default: ({ activeCategory, onCategoryChange }: { activeCategory: string; onCategoryChange: (s: string) => void }) => <button onClick={() => onCategoryChange('Granite')}>{activeCategory}</button> }));
vi.mock('../components/ProductGrid', () => ({ default: ({ activeCategory, searchTerm, onSearchChange, products }: { activeCategory: string; searchTerm: string; onSearchChange: (s: string) => void; products: { name: string }[] }) => <div><output>{activeCategory}: {products[0].name}</output><input aria-label="Search products" value={searchTerm} onChange={e => onSearchChange(e.target.value)} /></div> }));
afterEach(cleanup);

describe('Home page', () => {
  it('opens the default category and passes category and search changes to the grid', () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByText('Moda Quartz: Lincoln')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Moda Quartz' }));
    expect(screen.getByText('Granite: Lincoln')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'white' } });
    expect((screen.getByLabelText('Search products') as HTMLInputElement).value).toBe('white');
  });
  it('restores the category carried back from a product detail', () => {
    render(<MemoryRouter initialEntries={[{ pathname: '/products', state: { activeCategory: 'Marble' } }]}><HomePage /></MemoryRouter>);
    expect(screen.getByText('Marble: Lincoln')).toBeTruthy();
  });
});
