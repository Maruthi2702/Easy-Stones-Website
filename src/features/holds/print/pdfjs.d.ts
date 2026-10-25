// The minified legacy build the preview loads has the same exports as
// pdf.mjs, whose types pdfjs-dist ships beside it (pdf.d.mts).
declare module 'pdfjs-dist/legacy/build/pdf.min.mjs' {
  export * from 'pdfjs-dist/legacy/build/pdf.mjs';
}
