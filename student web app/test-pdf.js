import { PDFDocument } from 'pdf-lib';

async function run() {
  const srcDoc = await PDFDocument.create();
  srcDoc.addPage().drawText('Page 1');
  srcDoc.addPage().drawText('Page 2');
  srcDoc.addPage().drawText('Page 3');
  const pdfBytes = await srcDoc.save();
  
  const outDoc = await PDFDocument.create();
  const srcDocInstance = await PDFDocument.load(pdfBytes);
  const indices = srcDocInstance.getPageIndices();
  const embeddedPages = await outDoc.embedPdf(srcDocInstance, indices);
  console.log('embedPdf with indices count:', embeddedPages.length);
}
run();
