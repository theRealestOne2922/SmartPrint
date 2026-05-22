## Packages
react-dropzone | Provides beautiful drag-and-drop file upload capabilities needed for the document upload step
framer-motion | Essential for smooth, premium animations between the wizard steps and page transitions

## Notes
- Upload expects POST /api/upload with standard multipart/form-data containing the 'file' field
- The upload API returns file details including the calculated pageCount which is used to calculate the price locally
- Pricing logic is mirrored locally (BW: ₹2, Color: ₹10) for immediate UI feedback before submission
- We assume standard responsive mobile-first views with Tailwind
