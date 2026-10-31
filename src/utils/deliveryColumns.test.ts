import type { Loose } from '../types/records.ts';
import { describe, it, expect } from 'vitest';
import {
  defaultColumnOrder,
  orderBoardColumns,
  isDefaultOrder,
  cleanColumnOrder,
  moveItem,
  MAX_SAVED_COLUMNS
} from './deliveryColumns.ts';
import { WILL_CALL_COLUMN_ID } from './deliveryTypes.ts';

const col = (username: unknown, name = username): Loose => ({ id: `drv_${username}`, name, driver: name, username });
const thirdParty = col('3rd party - contract', '3rd Party - Contract');
const angel = col('angel', 'Angel');
const brock = col('brock', 'Brock');
const willCall = { id: WILL_CALL_COLUMN_ID, name: 'Will Call', driver: 'Will Call', isWillCall: true };
const ids = (cols: Loose[]) => cols.map((c: Loose) => c.id);

describe('defaultColumnOrder', () => {
  it('puts our drivers A–Z first, then contract trucks, then Will Call', () => {
    // The order the logins were created in — what the board used to show.
    expect(ids(defaultColumnOrder([thirdParty, willCall, brock, angel]))).toEqual([
      angel.id, brock.id, thirdParty.id, WILL_CALL_COLUMN_ID
    ]);
  });

  it('sorts names without caring about case', () => {
    const zed = col('zed', 'zed');
    const amy = col('amy', 'Amy');
    expect(ids(defaultColumnOrder([zed, amy]))).toEqual([amy.id, zed.id]);
  });

  it('does not change the list it was given', () => {
    const list = [brock, angel];
    defaultColumnOrder(list);
    expect(list).toEqual([brock, angel]);
  });
});

describe('orderBoardColumns', () => {
  const all = [thirdParty, angel, brock, willCall];

  it('uses the default order when the branch has none saved', () => {
    expect(ids(orderBoardColumns(all, null))).toEqual([angel.id, brock.id, thirdParty.id, WILL_CALL_COLUMN_ID]);
    expect(ids(orderBoardColumns(all, []))).toEqual([angel.id, brock.id, thirdParty.id, WILL_CALL_COLUMN_ID]);
  });

  it('follows the saved order, Will Call included', () => {
    const saved = [WILL_CALL_COLUMN_ID, brock.id, thirdParty.id, angel.id];
    expect(ids(orderBoardColumns(all, saved))).toEqual(saved);
  });

  it('skips saved ids that are no longer columns', () => {
    const saved = ['drv_gone', brock.id, angel.id, thirdParty.id, WILL_CALL_COLUMN_ID];
    expect(ids(orderBoardColumns(all, saved))).toEqual([brock.id, angel.id, thirdParty.id, WILL_CALL_COLUMN_ID]);
  });

  it('puts a new driver before the contract trucks and Will Call', () => {
    const cara = col('cara', 'Cara');
    const saved = [brock.id, angel.id, thirdParty.id, WILL_CALL_COLUMN_ID];
    expect(ids(orderBoardColumns([...all, cara], saved))).toEqual([
      brock.id, angel.id, cara.id, thirdParty.id, WILL_CALL_COLUMN_ID
    ]);
  });

  it('keeps several new drivers A–Z among themselves', () => {
    const cara = col('cara', 'Cara');
    const dan = col('dan', 'Dan');
    const saved = [brock.id, thirdParty.id];
    expect(ids(orderBoardColumns([dan, brock, cara, thirdParty], saved))).toEqual([
      brock.id, cara.id, dan.id, thirdParty.id
    ]);
  });

  it('puts a new contract truck before Will Call', () => {
    const freight = col('third party freight', 'Third Party Freight');
    const saved = [brock.id, angel.id, WILL_CALL_COLUMN_ID];
    expect(ids(orderBoardColumns([angel, brock, freight, willCall], saved))).toEqual([
      brock.id, angel.id, freight.id, WILL_CALL_COLUMN_ID
    ]);
  });

  it('adds a new column at the end when nothing later in the default is saved', () => {
    const saved = [brock.id, angel.id];
    expect(ids(orderBoardColumns(all, saved))).toEqual([brock.id, angel.id, thirdParty.id, WILL_CALL_COLUMN_ID]);
  });
});

describe('isDefaultOrder', () => {
  it('is true only for exactly the default order', () => {
    const all = [thirdParty, angel, brock, willCall];
    expect(isDefaultOrder(all, [angel.id, brock.id, thirdParty.id, WILL_CALL_COLUMN_ID])).toBe(true);
    expect(isDefaultOrder(all, [brock.id, angel.id, thirdParty.id, WILL_CALL_COLUMN_ID])).toBe(false);
    expect(isDefaultOrder(all, [angel.id, brock.id])).toBe(false);
  });
});

describe('cleanColumnOrder', () => {
  it('keeps a valid list, trimmed', () => {
    expect(cleanColumnOrder([' drv_angel ', WILL_CALL_COLUMN_ID])).toEqual(['drv_angel', WILL_CALL_COLUMN_ID]);
  });

  it('accepts an empty list (back to default)', () => {
    expect(cleanColumnOrder([])).toEqual([]);
  });

  it('refuses anything that is not a list of unique, non-empty strings', () => {
    expect(cleanColumnOrder('drv_angel')).toBeNull();
    expect(cleanColumnOrder(null)).toBeNull();
    expect(cleanColumnOrder(['drv_angel', 3])).toBeNull();
    expect(cleanColumnOrder(['drv_angel', ' '])).toBeNull();
    expect(cleanColumnOrder(['drv_angel', 'drv_angel'])).toBeNull();
    expect(cleanColumnOrder(['x'.repeat(201)])).toBeNull();
  });

  it('refuses a list longer than the cap', () => {
    const many = Array.from({ length: MAX_SAVED_COLUMNS + 1 }, (_, i) => `drv_${i}`);
    expect(cleanColumnOrder(many)).toBeNull();
  });
});

describe('moveItem', () => {
  it('moves one item and leaves the original alone', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(list, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(list).toEqual(['a', 'b', 'c']);
  });

  it('ignores moves off either end', () => {
    const list = ['a', 'b'];
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 1, 2)).toBe(list);
  });
});
