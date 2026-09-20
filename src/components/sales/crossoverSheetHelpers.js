// Pure helpers pulled out of CrossoverSheetTab.jsx so the matrix's grouping/
// sorting logic can be unit-tested the same way routePlannerV2/helpers.js is —
// see crossoverSheetHelpers.test.js.

// Flattens the API's one-document-per-color shape (each holding an embedded
// crossovers array) into one row per distributor mapping, carrying the
// parent document's _id as colorId — the shape the search/filter/
// pagination/edit logic in CrossoverSheetTab.jsx operates on.
export function flattenColorDocs(colorDocs) {
  return colorDocs.flatMap(doc =>
    (doc.crossovers || []).map(crossover => ({
      ...crossover,
      colorId: doc._id,
      easyStonesName: doc.easyStonesName
    }))
  );
}

// Groups flattened entries into the Matrix view's { distributors, rows }
// shape: one row per Easy Stones color, one column per distributor, cells
// holding the (usually single) mapping(s) between them.
//
// When matchTypeFilter is 'All', every catalog color gets its own row even
// with zero mappings yet (minus any filtered out by searchQuery), so staff
// can see what's still missing a distributor match. Skipped otherwise since
// an empty row has no match type to filter on.
export function buildMatrixData(filteredEntries, colorNames, { matchTypeFilter = 'All', searchQuery = '' } = {}) {
  const distributorsSet = new Set();
  const rowsMap = new Map();

  filteredEntries.forEach(item => {
    distributorsSet.add(item.distributorName);
    if (!rowsMap.has(item.easyStonesName)) rowsMap.set(item.easyStonesName, new Map());
    const colMap = rowsMap.get(item.easyStonesName);
    if (!colMap.has(item.distributorName)) colMap.set(item.distributorName, []);
    colMap.get(item.distributorName).push(item);
  });

  if (matchTypeFilter === 'All') {
    const q = searchQuery.toLowerCase().trim();
    colorNames.forEach(name => {
      if (rowsMap.has(name)) return;
      if (q && !name.toLowerCase().includes(q)) return;
      rowsMap.set(name, new Map());
    });
  }

  const distributors = Array.from(distributorsSet).sort((a, b) => a.localeCompare(b));
  const rows = Array.from(rowsMap.keys())
    .sort((a, b) => {
      // Follow the price sheet's order; anything not in the catalog
      // (custom or misspelled names) sorts alphabetically after it.
      const ai = colorNames.indexOf(a);
      const bi = colorNames.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    .map(easyStonesName => ({ easyStonesName, cells: rowsMap.get(easyStonesName) }));

  return { distributors, rows };
}

// Removes one crossover mapping from local color-doc state (after a
// successful delete, or the source side of a move), dropping the parent
// color document entirely if that was its last mapping — mirrors what the
// server does, so the frontend can patch state locally instead of
// refetching the whole crossover sheet after every edit.
export function removeCrossoverLocally(colorDocs, colorId, crossoverId) {
  return colorDocs
    .map(doc => doc._id === colorId
      ? { ...doc, crossovers: doc.crossovers.filter(c => c._id !== crossoverId) }
      : doc)
    .filter(doc => doc._id !== colorId || doc.crossovers.length > 0);
}

// Inserts or replaces a color document by _id — the shape every
// add/edit mutation's response already is, so applying it locally avoids a
// full refetch after every single save.
export function upsertColorDoc(colorDocs, colorDoc) {
  const idx = colorDocs.findIndex(doc => doc._id === colorDoc._id);
  if (idx === -1) return [...colorDocs, colorDoc];
  const next = [...colorDocs];
  next[idx] = colorDoc;
  return next;
}
