// exceljs ships a self-contained browser bundle (no Node built-ins like fs/stream)
// at this path — we import it directly on every platform (web + native) instead of
// letting bundlers pick "main", which pulls in Node-only code that breaks on native.
declare module 'exceljs/dist/exceljs.min.js' {
  const ExcelJS: any
  export default ExcelJS
}
