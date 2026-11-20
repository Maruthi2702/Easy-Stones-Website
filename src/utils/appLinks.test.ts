import { describe, expect, it } from 'vitest';
import { appSiteAssociation, pathForLink, IOS_TEAM_ID, IOS_BUNDLE_ID } from './appLinks.ts';

const HOST = ['easystones.onrender.com'];

describe('universal links', () => {
  it('names the app by team and bundle id', () => {
    expect(appSiteAssociation().applinks.details[0].appIDs).toEqual([`${IOS_TEAM_ID}.${IOS_BUNDLE_ID}`]);
  });
  it('lists a bare path as well as its children, and never /api', () => {
    const paths = appSiteAssociation().applinks.details[0].components.map(c => c['/']);
    expect(paths).toContain('/supplier');
    expect(paths).toContain('/supplier/*');
    expect(paths).toContain('/set-password');
    expect(paths.some(p => p.startsWith('/api'))).toBe(false);
  });
  it('opens an invite link with its token', () => {
    expect(pathForLink('https://easystones.onrender.com/set-password?token=abc', HOST)).toBe('/set-password?token=abc');
  });
  it('opens a page under /sales and /supplier', () => {
    expect(pathForLink('https://easystones.onrender.com/sales/customers#x', HOST)).toBe('/sales/customers#x');
    expect(pathForLink('https://easystones.onrender.com/supplier', HOST)).toBe('/supplier');
  });
  it('leaves other hosts, other paths, http and junk alone', () => {
    expect(pathForLink('https://evil.example/set-password?token=abc', HOST)).toBeNull();
    expect(pathForLink('https://easystones.onrender.com/products', HOST)).toBeNull();
    expect(pathForLink('https://easystones.onrender.com/api/auth/me', HOST)).toBeNull();
    expect(pathForLink('http://easystones.onrender.com/sales', HOST)).toBeNull();
    expect(pathForLink('https://easystones.onrender.com/salesforce', HOST)).toBeNull();
    expect(pathForLink('not a url', HOST)).toBeNull();
  });
});
