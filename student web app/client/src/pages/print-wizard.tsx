import { useState, useCallback, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/button";
import { PasswordModal } from "@/components/PasswordModal";
import { useUploadFile, useCreatePrintJob, getUniqueJobId, type UploadResponse } from "@/hooks/use-print";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, File, UploadCloud, X, Minus, Plus, Image, FileSpreadsheet, Layers, Eye, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { PDFDocument } from "pdf-lib";
// Supabase import removed — settings now fetched via Express API (MongoDB)
import { API_BASE } from "@/lib/api-config";
import officeCrypto from "officecrypto-tool";
import * as pdfjs from "pdfjs-dist";

// Point pdfjs to its worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const PRICE_BW = 2;
const PRICE_COLOR = 10;

// Office file extensions that officecrypto-tool can decrypt
const OFFICE_EXTENSIONS = new Set([
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'
]);

/** Helper to create a File from a buffer, avoiding TS constructor issues */
function createFile(data: BlobPart[], name: string, type: string): File {
  const blob = new Blob(data, { type });
  return new (window.File as any)([blob], name, { type, lastModified: Date.now() });
}

interface RecentPrint {
  jobId: string;
  fileName: string;
  timestamp: number;
}

/**
 * Detect if a file is encrypted/password-protected.
 * - PDF: Try loading with pdf-lib without ignoreEncryption
 * - Office: Check for OLE/CFB magic bytes (D0 CF 11 E0) which indicates
 *           an encrypted container (unencrypted OOXML files are ZIP-based starting with PK)
 */
async function detectEncryption(file: File): Promise<{ encrypted: boolean; type: 'pdf' | 'office' | 'none' }> {
  const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

  if (ext === '.pdf') {
    try {
      const arrayBuffer = await file.arrayBuffer();
      // Try loading WITHOUT ignoring encryption — will throw if encrypted
      await PDFDocument.load(arrayBuffer, { ignoreEncryption: false });
      return { encrypted: false, type: 'none' };
    } catch (e: any) {
      // pdf-lib throws when loading encrypted PDFs
      const msg = (e?.message || '').toLowerCase();
      if (msg.includes('encrypt') || msg.includes('password')) {
        return { encrypted: true, type: 'pdf' };
      }
      // Other parse errors — file might be corrupted, let the upload handle it
      return { encrypted: false, type: 'none' };
    }
  }

  if (OFFICE_EXTENSIONS.has(ext)) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const header = new Uint8Array(arrayBuffer.slice(0, 8));

      // OLE Compound File magic bytes: D0 CF 11 E0 A1 B1 1A E1
      // Password-protected Office files use this format instead of ZIP (PK...)
      const isOLE =
        header[0] === 0xD0 &&
        header[1] === 0xCF &&
        header[2] === 0x11 &&
        header[3] === 0xE0;

      if (isOLE) {
        return { encrypted: true, type: 'office' };
      }
    } catch {
      // Can't read header — proceed normally
    }
    return { encrypted: false, type: 'none' };
  }

  return { encrypted: false, type: 'none' };
}

/**
 * Decrypt a PDF client-side.
 * 
 * pdfjs-dist is the ONLY library that can actually decrypt PDF content.
 * pdf-lib's ignoreEncryption just skips the check — content stays encrypted.
 * 
 * Approach:
 * 1. pdfjs-dist opens the PDF with the password (actually decrypts content).
 * 2. Render each page to a canvas at high resolution.
 * 3. Build a brand new clean PDF from those rendered page images.
 * 
 * The output is rasterized but prints perfectly — no encryption, no empty pages.
 */
async function decryptPdfClientSide(file: File, password: string): Promise<File> {
  const arrayBuffer = await file.arrayBuffer();

  // Step 1: Open with pdfjs-dist using the password (this ACTUALLY decrypts)
  let pdfDocument: any;
  try {
    const loadingTask = pdfjs.getDocument({
      data: arrayBuffer.slice(0),
      password,
    });
    pdfDocument = await loadingTask.promise;
  } catch (e: any) {
    if (e?.name === 'PasswordException' || e?.code === 1 || e?.code === 2) {
      throw new Error("Incorrect password. Please try again.");
    }
    throw new Error("Could not open this PDF.");
  }

  // Step 2: Render every page to canvas → build a new clean PDF
  try {
    const newPdfDoc = await PDFDocument.create();
    const RENDER_SCALE = 2; // 144 DPI — good quality for printing

    for (let i = 1; i <= pdfDocument.numPages; i++) {
      const page = await pdfDocument.getPage(i);

      // Original page dimensions in PDF points (1pt = 1/72 inch)
      const origViewport = page.getViewport({ scale: 1 });

      // Render at higher resolution for print quality
      const renderViewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = renderViewport.width;
      canvas.height = renderViewport.height;
      const ctx = canvas.getContext('2d')!;

      await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;

      // Convert canvas to JPEG (smaller file, great for printing)
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.92)
      );
      const imgBytes = new Uint8Array(await blob.arrayBuffer());
      const img = await newPdfDoc.embedJpg(imgBytes);

      // Create page with original dimensions and draw the rendered image
      const newPage = newPdfDoc.addPage([origViewport.width, origViewport.height]);
      newPage.drawImage(img, {
        x: 0,
        y: 0,
        width: origViewport.width,
        height: origViewport.height,
      });
    }

    pdfDocument.destroy();
    const cleanBytes = await newPdfDoc.save();
    return createFile([cleanBytes as BlobPart], file.name, 'application/pdf');
  } catch (e: any) {
    pdfDocument?.destroy();
    throw new Error("Could not unlock this PDF. The file may be corrupted.");
  }
}

/**
 * Decrypt an Office file entirely client-side using officecrypto-tool.
 * No server needed — runs in the browser via Node.js polyfills.
 */
async function decryptOfficeClientSide(file: File, password: string): Promise<File> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // Check if actually encrypted
    const isEncrypted = officeCrypto.isEncrypted(fileBuffer);
    if (!isEncrypted) {
      return file; // Not encrypted, return as-is
    }

    // Decrypt with the provided password
    const decryptedBuffer = await officeCrypto.decrypt(fileBuffer, { password });
    return createFile([decryptedBuffer], file.name, file.type || "application/octet-stream");
  } catch (err: any) {
    const msg = (err?.message || '').toLowerCase();
    if (msg.includes('password') || msg.includes('decrypt') || msg.includes('invalid') || msg.includes('incorrect')) {
      throw new Error("Incorrect password. Please try again.");
    }
    throw new Error("Incorrect password or unsupported encryption. Please try again.");
  }
}

export type PrintSettings = {
  colorMode: 'bw' | 'color';
  copies: number;
  copiesInput: string;
  duplex: boolean;
  orientation: 'portrait' | 'landscape';
  paperSize: 'a4' | 'a3';
  pageRangeMode: 'all' | 'even' | 'odd' | 'custom';
  customRange: string;
};

const ACCEPTED_FILE_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'image/bmp': ['.bmp'],
  'text/plain': ['.txt'],
  'application/vnd.oasis.opendocument.text': ['.odt'],
  'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
  'application/vnd.oasis.opendocument.presentation': ['.odp'],
};

export default function PrintWizard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [maxFiles, setMaxFiles] = useState(5);
  const [confidential, setConfidential] = useState(false);
  // Admin-controlled kill switch, pending SDC's decision. Defaults true so the
  // toggle stays visible until the setting actually loads and says otherwise —
  // matching the server's own default, so there is no flash of the option
  // appearing and then disappearing on a slow connection.
  const [confidentialPrintingEnabled, setConfidentialPrintingEnabled] = useState(true);
  const [showVolumeWarning, setShowVolumeWarning] = useState(false);
  const [totalCalculatedCopies, setTotalCalculatedCopies] = useState(0);

  const isTeacher = typeof window !== 'undefined' ? !!localStorage.getItem("teacherId") : false;

  // Printing requires a signed-in member of staff. The server enforces this —
  // upload and job creation both reject an unauthenticated caller — so without
  // the redirect the page would let someone fill in the whole wizard and fail
  // at the end. Sending them to sign in first is the same rule, stated earlier.
  useEffect(() => {
    if (!localStorage.getItem("teacherToken")) {
      toast({
        title: "Please sign in",
        description: "Printing is for VIT staff. Sign in to continue.",
      });
      setLocation("/teacher-login");
    }
  }, []);

  useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await fetch(`${API_BASE}/api/settings`);
        if (!res.ok) throw new Error("Failed to fetch settings");
        const settings = await res.json();
        const maxFilesSetting = settings.find((s: any) => s.key === "maxFilesLimit");
        if (maxFilesSetting?.value) {
          const limit = parseInt(maxFilesSetting.value, 10);
          if (!isNaN(limit)) setMaxFiles(limit);
        }
        // Missing row means "true" — the server treats it the same way, and a
        // fresh deployment or a database that predates this setting must not
        // silently hide a working feature.
        const confSetting = settings.find((s: any) => s.key === "confidentialPrintingEnabled");
        const enabled = confSetting?.value !== "false";
        setConfidentialPrintingEnabled(enabled);
        if (!enabled) setConfidential(false);
      } catch (e) {
        console.error("Failed to load max files limit:", e);
      }
    }
    fetchSettings();
  }, []);

  const [step, setStep] = useState<1 | 2>(1);
  // Multi-file state
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileDetailsList, setFileDetailsList] = useState<UploadResponse[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isBatchSubmitting, setIsBatchSubmitting] = useState(false);


  // Print Settings State
  const [globalSettings, setGlobalSettings] = useState<PrintSettings>({
    colorMode: 'bw', copies: 1, copiesInput: '1', duplex: false, orientation: 'portrait', paperSize: 'a4', pageRangeMode: 'all', customRange: ''
  });
  const [previewFileIndex, setPreviewFileIndex] = useState<number | null>(null);
  const [fileSettings, setFileSettings] = useState<Record<number, PrintSettings>>({});
  const [expandedFileIndex, setExpandedFileIndex] = useState<number | null>(null);

  // Booklet preview state
  const [bookletPreviewUrl, setBookletPreviewUrl] = useState<string | null>(null);
  const [isGeneratingBooklet, setIsGeneratingBooklet] = useState(false);
  // Direct-preview blob state, for a plain (non-booklet) PDF or an image. The
  // obvious thing would be to point the iframe/img straight at fd.filePath,
  // but that URL is on the API's origin — this page's CSP only allows
  // frame-src 'self'/blob:/docs.google.com and img-src 'self'/data:/blob:, so
  // a direct cross-origin src is silently blocked by the browser either way.
  // Fetching the bytes ourselves and rendering a blob: URL sidesteps that
  // without loosening the CSP, the same way the booklet view already does.
  const [directPreviewUrl, setDirectPreviewUrl] = useState<string | null>(null);
  const [isLoadingDirectPreview, setIsLoadingDirectPreview] = useState(false);
  const getSettingsFor = (index: number | null) => index !== null && fileSettings[index] ? fileSettings[index] : globalSettings;

  // Derive the active paper size for the currently-previewed file so the booklet
  // effect only re-runs when this specific value changes (not on every settings tweak).
  const previewPaperSize = previewFileIndex !== null && fileSettings[previewFileIndex]
    ? fileSettings[previewFileIndex].paperSize
    : globalSettings.paperSize;
  
  const updateSettingsFor = (index: number | null, updates: Partial<PrintSettings>) => {
    if (index === null) {
      setGlobalSettings(prev => ({ ...prev, ...updates }));
      setFileSettings(prev => {
        const next = { ...prev };
        for (let i = 0; i < fileDetailsList.length; i++) {
          next[i] = { ...(next[i] || globalSettings), ...updates };
        }
        return next;
      });
    } else {
      setFileSettings(prev => ({ ...prev, [index]: { ...(prev[index] || globalSettings), ...updates } }));
    }
  };

  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [settingsSnapshot, setSettingsSnapshot] = useState<Record<number, PrintSettings> | null>(null);

  const toggleGlobalSettings = (checked: boolean) => {
    if (checked) {
      // Save snapshot of current individual settings
      setSettingsSnapshot({ ...fileSettings });
    } else {
      // Restore from snapshot if it exists
      if (settingsSnapshot) {
        setFileSettings(settingsSnapshot);
      }
    }
    setShowGlobalSettings(checked);
  };

  const [studentName, setStudentName] = useState(() => {
    const adminAuth = localStorage.getItem("adminAuth");
    const teacherName = localStorage.getItem("teacherName");
    if (adminAuth) return "Admin";
    if (teacherName) return teacherName;
    return "";
  });
  const [recentPrints, setRecentPrints] = useState<RecentPrint[]>([]);

  // Encryption modal state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [encryptedFile, setEncryptedFile] = useState<File | null>(null);
  const [encryptionType, setEncryptionType] = useState<'pdf' | 'office' | 'none'>('none');
  const [decryptLoading, setDecryptLoading] = useState(false);
  const [decryptError, setDecryptError] = useState<string | null>(null);

  const uploadMutation = useUploadFile();
  const createJobMutation = useCreatePrintJob();

  // Booklet / direct (PDF or image) preview generator effect
  useEffect(() => {
    // Track the blob URLs created in this effect run so we can revoke them on cleanup
    let currentBlobUrl: string | null = null;
    let currentDirectBlobUrl: string | null = null;

    if (previewFileIndex === null) {
      setBookletPreviewUrl(null);
      setDirectPreviewUrl(null);
      return;
    }

    const fd = fileDetailsList[previewFileIndex];
    if (!fd) return;

    const ext = fd.fileName.toLowerCase().split('.').pop() || '';
    const isPdf = ext === 'pdf';
    const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'jfif', 'svg', 'tiff', 'tif', 'heic', 'avif'].includes(ext);
    const settings = getSettingsFor(previewFileIndex);

    if (isImg || (isPdf && settings.paperSize !== 'a3')) {
      setDirectPreviewUrl(null);
      setIsLoadingDirectPreview(true);
      (async () => {
        try {
          const response = await fetch(fd.filePath);
          // response.blob() carries the server's real Content-Type, so this
          // works for both formats without guessing a MIME type from the name.
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          currentDirectBlobUrl = url;
          setDirectPreviewUrl(url);
        } catch (e) {
          console.error("Failed to load preview:", e);
        } finally {
          setIsLoadingDirectPreview(false);
        }
      })();
    } else {
      setDirectPreviewUrl(null);
    }

    if (isPdf && settings.paperSize === 'a3') {
      setIsGeneratingBooklet(true);

      const generateBooklet = async () => {
        try {
          // Fetch the PDF blob
          const response = await fetch(fd.filePath);
          const pdfBytes = await response.arrayBuffer();
          
          const srcDoc = await PDFDocument.load(pdfBytes);
          const outDoc = await PDFDocument.create();
          
          const srcPages = srcDoc.getPages();
          const numPages = srcPages.length;
          
          const a4Width = 595.28;
          const a4Height = 841.89;
          
          // Standard Saddle-Stitch Booklet logic
          const paddedCount = Math.ceil(numPages / 4) * 4;
          const embeddedPages = await outDoc.embedPdf(srcDoc, srcDoc.getPageIndices());
          
          const pageArray: any[] = [];
          for (let i = 0; i < paddedCount; i++) {
            pageArray.push(i < numPages ? embeddedPages[i] : null);
          }
          
          const sheets = paddedCount / 4;
          for (let s = 0; s < sheets; s++) {
            // Front side of A3 sheet
            const frontPage = outDoc.addPage([a4Width * 2, a4Height]);
            const leftFrontIdx = paddedCount - 2 * s - 1;
            const rightFrontIdx = 2 * s;
            
            if (pageArray[leftFrontIdx]) {
              frontPage.drawPage(pageArray[leftFrontIdx], { x: 0, y: 0, width: a4Width, height: a4Height });
            }
            if (pageArray[rightFrontIdx]) {
              frontPage.drawPage(pageArray[rightFrontIdx], { x: a4Width, y: 0, width: a4Width, height: a4Height });
            }
            
            // Back side of A3 sheet
            const backPage = outDoc.addPage([a4Width * 2, a4Height]);
            const leftBackIdx = 2 * s + 1;
            const rightBackIdx = paddedCount - 2 * s - 2;
            
            if (pageArray[leftBackIdx]) {
              backPage.drawPage(pageArray[leftBackIdx], { x: 0, y: 0, width: a4Width, height: a4Height });
            }
            if (pageArray[rightBackIdx]) {
              backPage.drawPage(pageArray[rightBackIdx], { x: a4Width, y: 0, width: a4Width, height: a4Height });
            }
          }
          
          const outBytes = await outDoc.save();
          const blob = new Blob([outBytes], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          currentBlobUrl = url;
          setBookletPreviewUrl(url);
        } catch (e) {
          console.error("Failed to generate booklet preview:", e);
        } finally {
          setIsGeneratingBooklet(false);
        }
      };
      
      generateBooklet();
    } else {
      setBookletPreviewUrl(null);
    }

    // Cleanup: revoke the blob URLs when the effect re-runs or unmounts to prevent memory leaks
    return () => {
      if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
      }
      if (currentDirectBlobUrl) {
        URL.revokeObjectURL(currentDirectBlobUrl);
      }
    };
  }, [previewFileIndex, fileDetailsList, previewPaperSize]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('smartprint_recent_jobs');
      if (stored) {
        setRecentPrints(JSON.parse(stored).slice(0, 5));
      }
    } catch (e) {
      console.error('Failed to load recent prints', e);
    }
  }, []);

  /**
   * Add file to the pending list (called with the original file or decrypted file)
   */
  const proceedWithUpload = useCallback((file: File) => {
    setPendingFiles(prev => {
      if (prev.length >= maxFiles) {
        toast({ title: "Limit reached", description: `You can upload up to ${maxFiles} files at once.`, variant: "destructive" });
        return prev;
      }
      return [...prev, file];
    });
  }, [toast, maxFiles]);

  /**
   * Remove a file from the pending list
   */
  const removeFile = useCallback((index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  /**
   * Upload all pending files and move to step 2
   */
  const uploadAllFiles = useCallback(async () => {
    if (pendingFiles.length === 0) return;
    setIsUploading(true);
    const results: UploadResponse[] = [];
    for (const file of pendingFiles) {
      try {
        const data = await uploadMutation.mutateAsync(file);
        results.push(data);
      } catch (err: any) {
        toast({ title: "Upload failed", description: `${file.name}: ${err.message}`, variant: "destructive" });
        setIsUploading(false);
        return;
      }
    }
    setFileDetailsList(results);
    setIsUploading(false);
    setStep(2);
  }, [pendingFiles, uploadMutation, toast]);

  /**
   * Handle password submission from the modal
   */
  const handlePasswordSubmit = useCallback(async (password: string) => {
    if (!encryptedFile) return;

    setDecryptLoading(true);
    setDecryptError(null);

    try {
      let decryptedFile: File;

      if (encryptionType === 'pdf') {
        decryptedFile = await decryptPdfClientSide(encryptedFile, password);
      } else {
        decryptedFile = await decryptOfficeClientSide(encryptedFile, password);
      }

      // Success — close modal and add the decrypted file
      setShowPasswordModal(false);
      setEncryptedFile(null);
      setDecryptError(null);
      proceedWithUpload(decryptedFile);
    } catch (err: any) {
      setDecryptError(err.message || "Incorrect password. Please try again.");
    } finally {
      setDecryptLoading(false);
    }
  }, [encryptedFile, encryptionType, proceedWithUpload]);

  /**
   * Cancel password modal
   */
  const handlePasswordCancel = useCallback(() => {
    setShowPasswordModal(false);
    setEncryptedFile(null);
    setDecryptError(null);
  }, []);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!studentName.trim()) {
      toast({ title: "Name Required", description: "Please enter your name before uploading.", variant: "destructive" });
      return;
    }

    const remaining = maxFiles - pendingFiles.length;
    const filesToAdd = acceptedFiles.slice(0, remaining);
    if (acceptedFiles.length > remaining) {
      toast({ title: "Limit reached", description: `Only ${remaining} more file${remaining !== 1 ? 's' : ''} can be added (max ${maxFiles}).`, variant: "destructive" });
    }

    for (const file of filesToAdd) {
      if (file.size > 20 * 1024 * 1024) {
        toast({ title: "File too large", description: `${file.name} exceeds 20MB limit.`, variant: "destructive" });
        continue;
      }

      // Check for encryption
      try {
        const { encrypted, type } = await detectEncryption(file);
        if (encrypted) {
          setEncryptedFile(file);
          setEncryptionType(type);
          setDecryptError(null);
          setShowPasswordModal(true);
          continue;
        }
      } catch (e) {
        console.error("Encryption detection error:", e);
      }

      proceedWithUpload(file);
    }
  }, [toast, studentName, proceedWithUpload, pendingFiles.length, maxFiles]);


  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: maxFiles,
    multiple: true,
    accept: ACCEPTED_FILE_TYPES,
    disabled: pendingFiles.length >= maxFiles || isUploading,
  });

  const computePageRange = (settings: PrintSettings, pageCount: number) => {
    if (settings.pageRangeMode === 'all') return 'all';
    if (settings.pageRangeMode === 'even') {
      const pages = [];
      for (let i = 2; i <= pageCount; i += 2) pages.push(i);
      return pages.join(',') || 'all';
    }
    if (settings.pageRangeMode === 'odd') {
      const pages = [];
      for (let i = 1; i <= pageCount; i += 2) pages.push(i);
      return pages.join(',') || 'all';
    }
    return settings.customRange.trim() || 'all';
  };

  // calculateBillablePages removed for Teacher Edition

  const executeJobCreation = async () => {
    setIsBatchSubmitting(true);
    setShowVolumeWarning(false);
    const createdJobs: any[] = [];
    const newRecentPrints: RecentPrint[] = [];

    try {
      // Generate one code for the entire batch
      const batchJobId = await getUniqueJobId();

      for (let index = 0; index < fileDetailsList.length; index++) {
        const fd = fileDetailsList[index];
        const settings = getSettingsFor(index);

        const data = await createJobMutation.mutateAsync({
          jobId: batchJobId,
          studentName,
          fileName: fd.fileName,
          filePath: fd.filePath,
          pageCount: fd.pageCount,
          colorMode: settings.colorMode,
          copies: settings.copies,
          duplex: settings.duplex,
          orientation: settings.orientation,
          paperSize: settings.paperSize,
          pageRange: computePageRange(settings, fd.pageCount),
          confidential: confidential,
        });
        createdJobs.push(data);
      }

      // Recent Prints is a convenience for walk-in students who may lose their
      // code. A confidential job must never land here: this list is written to
      // localStorage, so it survives the browser closing, and it renders both
      // the code and the file name on screen. For a confidential job that is
      // the whole secret sitting in plain text on a shared staff machine —
      // exactly what sending the code by email instead of showing it is meant
      // to prevent.
      if (!confidential) {
        const summaryName = fileDetailsList.length === 1
          ? fileDetailsList[0].fileName
          : `${fileDetailsList.length} files batch`;

        newRecentPrints.push({ jobId: batchJobId, fileName: summaryName, timestamp: Date.now() });

        const updated = [...newRecentPrints, ...recentPrints].slice(0, 5);
        setRecentPrints(updated);
        try { localStorage.setItem('smartprint_recent_jobs', JSON.stringify(updated)); } catch (e) { /* ignore */ }
      }

      setIsBatchSubmitting(false);
      // Navigate to unified status page
      sessionStorage.setItem("current_job_id", batchJobId);
      setLocation(`/status`);

    } catch (err: any) {
      toast({ title: "Could not create job", description: err.message, variant: "destructive" });
      setIsBatchSubmitting(false);
    }
  };

  const handleCreateJob = async () => {
    if (fileDetailsList.length === 0) return;

    // Check for high volume
    let totalCopies = 0;
    for (let index = 0; index < fileDetailsList.length; index++) {
      const fd = fileDetailsList[index];
      const settings = getSettingsFor(index);
      totalCopies += (fd.pageCount * settings.copies);
    }

    if (totalCopies > 50) {
      setTotalCalculatedCopies(totalCopies);
      setShowVolumeWarning(true);
      return;
    }

    await executeJobCreation();
  };

  // Pricing logic removed

  return (
    <Layout>
      <div className="flex-1 flex flex-col max-w-2xl w-full mx-auto px-4 py-8">

        {/* Password Modal */}
        <PasswordModal
          isOpen={showPasswordModal}
          onCancel={handlePasswordCancel}
          onSubmit={handlePasswordSubmit}
          isLoading={decryptLoading}
          error={decryptError}
          fileName={encryptedFile?.name || ""}
        />

        {/* High Volume Warning Modal */}
        {showVolumeWarning && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-card w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 text-center space-y-4">
                <div className="w-16 h-16 bg-yellow-100 text-yellow-600 rounded-full flex items-center justify-center mx-auto mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                </div>
                <h2 className="text-2xl font-bold">High Volume Print</h2>
                <p className="text-muted-foreground">
                  Your print job contains <strong>{totalCalculatedCopies}</strong> total pages. Are you sure you want to continue?
                </p>
                <div className="flex gap-3 pt-4">
                  <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowVolumeWarning(false)}>
                    Cancel
                  </Button>
                  <Button className="flex-1 rounded-xl" onClick={executeJobCreation}>
                    Yes, Print
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
        {/* Simple Stepper */}
        <div className="flex items-center justify-center mb-10">
          <div className={`flex items-center justify-center w-10 h-10 rounded-full font-bold text-sm ${step >= 1 ? 'bg-primary text-black' : 'bg-secondary text-muted-foreground'}`}>
            1
          </div>
          <div className={`w-16 h-1 mx-2 rounded-full ${step >= 2 ? 'bg-primary' : 'bg-secondary'}`} />
          <div className={`flex items-center justify-center w-10 h-10 rounded-full font-bold text-sm ${step >= 2 ? 'bg-primary text-black' : 'bg-secondary text-muted-foreground'}`}>
            2
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          <AnimatePresence mode="wait">

            {/* STEP 1: UPLOAD */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3 }}
              >
                <div className="text-center mb-8">
                  <h2 className="text-3xl font-bold mb-2">Upload your Files</h2>
                  <p className="text-muted-foreground">Select up to {maxFiles} documents or images to print.</p>
                </div>

                {!(typeof window !== 'undefined' && (localStorage.getItem("teacherName") || localStorage.getItem("adminAuth"))) && (
                  <div className="mb-8 max-w-sm mx-auto">
                    <label className="block text-sm font-semibold mb-2 text-left">Your Name</label>
                    <input
                      type="text"
                      placeholder="Enter your name"
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary shadow-sm"
                    />
                  </div>
                  )}

                <div
                  {...getRootProps()}
                  className={`
                    border-2 border-dashed rounded-3xl p-10 text-center cursor-pointer transition-all duration-300
                    ${isDragActive ? 'border-primary bg-primary/5 scale-[1.02]' : 'border-border bg-card hover:border-primary/50 hover:bg-secondary/50'}
                    ${!studentName.trim() || pendingFiles.length >= maxFiles ? 'opacity-50 pointer-events-none' : ''}
                  `}
                >
                  <input {...getInputProps()} disabled={!studentName.trim() || pendingFiles.length >= maxFiles} />

                  <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mx-auto mb-4">
                    <UploadCloud className={`w-8 h-8 ${isDragActive ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>

                  <h3 className="text-lg font-semibold mb-1">
                    {isDragActive ? 'Drop files here!' : pendingFiles.length >= maxFiles ? `Maximum ${maxFiles} files reached` : 'Click or drag files here'}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-1">PDF, Word, PowerPoint, Excel, Images</p>
                  <p className="text-xs text-muted-foreground mb-3">Max 20MB per file • Up to {maxFiles} files • Password-protected supported</p>
                  {pendingFiles.length < maxFiles && (
                    <Button variant="secondary" className="pointer-events-none">
                      Browse Files
                    </Button>
                  )}
                </div>

                {/* Selected Files List */}
                {pendingFiles.length > 0 && (
                  <div className="mt-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold">{pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''} selected</h3>
                      <span className="text-xs text-muted-foreground">{maxFiles - pendingFiles.length} more allowed</span>
                    </div>
                    <div className="space-y-2">
                      {pendingFiles.map((file, index) => {
                        const ext = file.name.toLowerCase().split('.').pop() || '';
                        const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
                        const isExcel = ['xls', 'xlsx', 'ods'].includes(ext);
                        const FileIcon = isImage ? Image : isExcel ? FileSpreadsheet : FileText;
                        return (
                          <motion.div
                            key={`${file.name}-${index}`}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="bg-card border border-border rounded-2xl p-3 flex items-center justify-between shadow-sm"
                          >
                            <div className="flex items-center gap-3 overflow-hidden min-w-0">
                              <div className="w-9 h-9 bg-primary/10 text-primary rounded-xl flex items-center justify-center shrink-0">
                                <FileIcon className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-sm truncate">{file.name}</p>
                                <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
                              </div>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); removeFile(index); }}
                              className="p-1.5 hover:bg-destructive/10 rounded-full text-muted-foreground hover:text-destructive transition-colors shrink-0"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </motion.div>
                        );
                      })}
                    </div>

                    <Button
                      size="lg"
                      className="w-full mt-6"
                      onClick={uploadAllFiles}
                      isLoading={isUploading}
                      disabled={isUploading}
                    >
                      {isUploading ? `Uploading ${pendingFiles.length} file${pendingFiles.length !== 1 ? 's' : ''}...` : `Continue with ${pendingFiles.length} file${pendingFiles.length !== 1 ? 's' : ''}`}
                    </Button>
                  </div>
                )}

                {recentPrints.length > 0 && pendingFiles.length === 0 && (
                  <div className="mt-12 max-w-sm mx-auto">
                    <h3 className="text-lg font-semibold mb-4 text-left">Recent Prints</h3>
                    <div className="space-y-3">
                      {recentPrints.map((print) => (
                        <div 
                          key={print.jobId} 
                          onClick={() => {
                            sessionStorage.setItem("current_job_id", print.jobId);
                            setLocation("/status");
                          }}
                          className="bg-card border border-border rounded-2xl p-4 flex items-center justify-between hover:border-primary/50 transition-colors cursor-pointer group shadow-sm"
                        >
                          <div className="flex items-center gap-3 overflow-hidden">
                            <div className="w-10 h-10 bg-primary/10 text-primary rounded-xl flex items-center justify-center shrink-0">
                              <FileText className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{print.fileName}</p>
                              <p className="text-xs text-muted-foreground">{new Date(print.timestamp).toLocaleDateString()}</p>
                            </div>
                          </div>
                          <div className="text-xs font-bold bg-secondary px-2 py-1 rounded-md text-muted-foreground group-hover:bg-primary group-hover:text-black transition-colors">
                            {print.jobId}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* STEP 2: SETTINGS */}
            {step === 2 && fileDetailsList.length > 0 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col h-full"
              >
                <div className="text-center mb-8">
                  <h2 className="text-3xl font-bold mb-2">Print Settings</h2>
                  <p className="text-muted-foreground">
                    {fileDetailsList.length === 1
                      ? 'Configure how you want your document printed.'
                      : `Settings apply to all ${fileDetailsList.length} files.`}
                  </p>
                </div>

                {/* File Preview Cards */}
                <div className="space-y-2 mb-8">
                  {fileDetailsList.map((fd, idx) => {
                    const ext = fd.fileName.toLowerCase().split('.').pop() || '';
                    const isPdf = ext === 'pdf';
                    const isWord = ['doc', 'docx', 'odt'].includes(ext);
                    const isPpt = ['ppt', 'pptx', 'odp'].includes(ext);
                    const isExcel = ['xls', 'xlsx', 'ods'].includes(ext);
                    const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
                    const iconBg = isPdf ? 'bg-red-50 text-red-500'
                      : isWord ? 'bg-blue-50 text-blue-500'
                      : isPpt ? 'bg-orange-50 text-orange-500'
                      : isExcel ? 'bg-green-50 text-green-500'
                      : isImg ? 'bg-purple-50 text-purple-500'
                      : 'bg-gray-50 text-gray-500';
                    const FIcon = isImg ? Image : isExcel ? FileSpreadsheet : FileText;
                    return (
                      <div key={idx} className="bg-card border border-border p-3 rounded-2xl shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 ${iconBg} rounded-xl flex items-center justify-center shrink-0`}>
                            <FIcon className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-sm truncate">{fd.fileName}</p>
                            <p className="text-xs text-muted-foreground">
                              {fd.pageCount} page{fd.pageCount !== 1 ? 's' : ''}{!isPdf ? ' (est.)' : ''}
                            </p>
                          </div>
                          <button
                            onClick={() => setExpandedFileIndex(expandedFileIndex === idx ? null : idx)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-full bg-secondary/50 hover:bg-secondary text-foreground transition-colors"
                          >
                            {expandedFileIndex === idx ? 'Close' : 'Customize'}
                          </button>
                        </div>

                        {/* Expanded Panel */}
                        <AnimatePresence>
                          {expandedFileIndex === idx && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="w-full border-t border-border mt-3 pt-4 overflow-hidden"
                            >
                              <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                  {/* Color Mode */}
                                  <div>
                                    <label className="text-xs font-semibold mb-2 block">Format</label>
                                    <div className="flex bg-secondary/30 p-1 rounded-xl">
                                      <button
                                        onClick={() => updateSettingsFor(idx, { colorMode: 'bw' })}
                                        className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${getSettingsFor(idx).colorMode === 'bw' ? 'bg-primary text-black shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                                      >
                                        B&W
                                      </button>
                                      <button
                                        onClick={() => updateSettingsFor(idx, { colorMode: 'color' })}
                                        className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${getSettingsFor(idx).colorMode === 'color' ? 'bg-primary text-black shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                                      >
                                        Color
                                      </button>
                                    </div>
                                  </div>
                                  
                                  {/* Copies */}
                                  <div>
                                    <label className="text-xs font-semibold mb-2 block">Copies</label>
                                    <div className="flex items-center gap-2 bg-secondary/30 p-1 rounded-xl">
                                      <button
                                        onClick={() => updateSettingsFor(idx, { copies: Math.max(1, getSettingsFor(idx).copies - 1) })}
                                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-card shadow-sm hover:bg-primary/20"
                                      >
                                        <Minus className="w-3 h-3" />
                                      </button>
                                      <span className="flex-1 text-center font-bold text-sm">{getSettingsFor(idx).copies}</span>
                                      <button
                                        onClick={() => updateSettingsFor(idx, { copies: Math.min(500, getSettingsFor(idx).copies + 1) })}
                                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-card shadow-sm hover:bg-primary/20"
                                      >
                                        <Plus className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                  {/* Duplex (Sides) */}
                                  <div>
                                    <label className="text-xs font-semibold mb-2 block">Sides</label>
                                    <div className="flex bg-secondary/30 p-1 rounded-xl">
                                      <button
                                        onClick={() => updateSettingsFor(idx, { duplex: false })}
                                        className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${!getSettingsFor(idx).duplex ? 'bg-primary text-black shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                                      >
                                        Single
                                      </button>
                                      <button
                                        onClick={() => updateSettingsFor(idx, { duplex: true })}
                                        className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${getSettingsFor(idx).duplex ? 'bg-primary text-black shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                                      >
                                        Double
                                      </button>
                                    </div>
                                  </div>

                                  {/* Orientation */}
                                  {getSettingsFor(idx).paperSize !== 'a3' && (
                                    <div>
                                      <label className="text-xs font-semibold mb-2 block">Orientation</label>
                                      <div className="flex bg-secondary/30 p-1 rounded-xl">
                                        <button
                                          onClick={() => updateSettingsFor(idx, { orientation: 'portrait' })}
                                          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${getSettingsFor(idx).orientation === 'portrait' ? 'bg-primary text-black shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                                        >
                                          Portrait
                                        </button>
                                        <button
                                          onClick={() => updateSettingsFor(idx, { orientation: 'landscape' })}
                                          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${getSettingsFor(idx).orientation === 'landscape' ? 'bg-primary text-black shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                                        >
                                          Landscape
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>

                                {/* Paper Size */}
                                <div>
                                  <label className="text-xs font-semibold mb-2 block">Paper Size</label>
                                  <div className="flex bg-secondary/30 p-1 rounded-xl">
                                    <button
                                      onClick={() => updateSettingsFor(idx, { paperSize: 'a4' })}
                                      className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${getSettingsFor(idx).paperSize === 'a4' ? 'bg-primary text-black shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                                    >
                                      A4
                                    </button>
                                    <button
                                      onClick={() => updateSettingsFor(idx, { paperSize: 'a3' })}
                                      className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${getSettingsFor(idx).paperSize === 'a3' ? 'bg-primary text-black shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                                    >
                                      A3 (Booklet)
                                    </button>
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                  {/* Page Range Mode */}
                                  <div>
                                    <label className="text-xs font-semibold mb-2 block">Page Range</label>
                                    <select
                                      value={getSettingsFor(idx).pageRangeMode}
                                      onChange={(e) => updateSettingsFor(idx, { pageRangeMode: e.target.value as any })}
                                      className="w-full bg-secondary/30 p-2 text-xs font-bold rounded-xl outline-none border border-transparent focus:border-primary text-foreground"
                                    >
                                      <option value="all">All Pages ({fd.pageCount})</option>
                                      <option value="odd">Odd Pages</option>
                                      <option value="even">Even Pages</option>
                                      <option value="custom">Custom Range</option>
                                    </select>
                                  </div>

                                  {/* Preview */}
                                  <div>
                                    <label className="text-xs font-semibold mb-2 block">Preview</label>
                                    <button
                                      onClick={() => setPreviewFileIndex(idx)}
                                      className="w-full flex items-center justify-center gap-2 bg-secondary/30 hover:bg-secondary p-2 text-xs font-bold rounded-xl transition-colors text-foreground"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                      Preview File
                                    </button>
                                  </div>
                                </div>

                                {/* Custom range input inside expanded panel */}
                                {getSettingsFor(idx).pageRangeMode === 'custom' && (
                                  <div>
                                    <input
                                      type="text"
                                      value={getSettingsFor(idx).customRange}
                                      onChange={(e) => updateSettingsFor(idx, { customRange: e.target.value })}
                                      placeholder="e.g. 1-5, 8, 11-13"
                                      className="w-full bg-secondary/30 border border-border rounded-xl px-3 py-2 outline-none text-xs focus:border-primary text-foreground"
                                    />
                                    <p className="text-[10px] text-muted-foreground mt-1 ml-1">
                                      Enter pages separated by commas or hyphens (e.g. 1-5, 8).
                                    </p>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                  <button
                    onClick={() => {
                      setStep(1);
                      setFileDetailsList([]);
                      setPendingFiles([]);
                    }}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors mt-1"
                  >
                    ← Change files
                  </button>
                </div>

                
                {/* Global Settings */}
                <div className="bg-card/50 border border-border rounded-3xl p-6 shadow-sm transition-colors mb-8">
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-bold">Global Options (Apply to all files)</span>
                    <Switch checked={showGlobalSettings} onCheckedChange={toggleGlobalSettings} />
                  </div>
                  {showGlobalSettings && (
                    <div className="space-y-8 mt-6">
                      <div className="bg-primary/10 border border-primary/20 p-4 rounded-2xl text-sm flex items-start gap-3">
                        <Info className="w-5 h-5 shrink-0 mt-0.5 text-primary" />
                        <p className="text-foreground leading-relaxed">
                          <strong className="text-primary">Quick Actions:</strong> Selecting an option here instantly applies it to <strong>all</strong> your files below.
                          <br />
                          <span className="opacity-80">It will only update that specific setting—the rest of your individual file options will remain unaffected!</span>
                        </p>
                      </div>
                    <div>
                      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">Global Color Mode</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => updateSettingsFor(null, { colorMode: 'bw' })}
                        className={`group flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all duration-200 outline-none
                          ${globalSettings.colorMode === 'bw'
                            ? 'border-primary bg-primary/5 shadow-[0_0_20px_rgba(var(--primary-rgb),0.15)] scale-[1.02]'
                            : 'border-border bg-card hover:border-primary/40 hover:bg-primary/5 hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(var(--primary-rgb),0.1)] text-muted-foreground'}`}
                      >
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-3 transition-all duration-200
                          ${globalSettings.colorMode === 'bw' ? 'bg-primary text-black shadow-md' : 'bg-secondary group-hover:bg-primary/20 group-hover:text-foreground'}`}>
                          <File className="w-5 h-5" />
                        </div>
                        <span className="font-bold text-sm">Black & White</span>
                      </button>

                      <button
                        onClick={() => updateSettingsFor(null, { colorMode: 'color' })}
                        className={`group flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all duration-200 outline-none
                          ${globalSettings.colorMode === 'color'
                            ? 'border-primary bg-primary/5 shadow-[0_0_20px_rgba(var(--primary-rgb),0.15)] scale-[1.02]'
                            : 'border-border bg-card hover:border-primary/40 hover:bg-primary/5 hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(var(--primary-rgb),0.1)] text-muted-foreground'}`}>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-3 transition-all duration-200
                          ${globalSettings.colorMode === 'color' ? 'bg-primary text-black shadow-md' : 'bg-secondary group-hover:bg-primary/20'}`}>
                          <div className="flex gap-[2px]">
                            <div className="w-2.5 h-2.5 rounded-full bg-red-400"></div>
                            <div className="w-2.5 h-2.5 rounded-full bg-green-400"></div>
                            <div className="w-2.5 h-2.5 rounded-full bg-blue-400"></div>
                          </div>
                        </div>
                        <span className="font-bold text-sm">Color</span>
                      </button>
                    </div>
                  </div>

                  {/* Hidden entirely, not disabled — an admin has turned this
                      off pending a decision above their own authority, and
                      leaving a disabled control visible would just invite a
                      "why can't I click this" support question. The server
                      enforces the same switch independently; this is not the
                      only thing standing between a request and a confidential
                      job. */}
                  {isTeacher && confidentialPrintingEnabled && (
                    <div className="mt-8 border-t border-border pt-8">
                      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        Security Options
                      </h3>
                      <div className="flex items-center justify-between bg-card border border-border p-5 rounded-2xl shadow-sm">
                        <div>
                          <p className="font-bold">Confidential Print Job</p>
                          <p className="text-sm text-muted-foreground mt-1">Requires Faculty ID verification at the Kiosk. Files are encrypted on the server.</p>
                        </div>
                        <Switch checked={confidential} onCheckedChange={setConfidential} />
                      </div>
                    </div>
                  )}

                  <div>
                    <h3 className="text-lg font-semibold mb-4">Global Copies</h3>
                    <div className="flex items-center gap-4 bg-card border border-border p-2 rounded-2xl w-fit shadow-sm">
                      <button
                        onClick={() => { const v = Math.max(1, globalSettings.copies - 1); updateSettingsFor(null, { copies: v, copiesInput: String(v) }); }}
                        disabled={globalSettings.copies <= 1}
                        className="w-12 h-12 flex items-center justify-center rounded-xl bg-secondary hover:bg-primary hover:text-black transition-all duration-200 disabled:opacity-30 disabled:hover:bg-secondary disabled:hover:text-foreground active:scale-95"
                      >
                        <Minus className="w-5 h-5" />
                      </button>
                      <span className="text-2xl font-bold w-16 text-center tabular-nums">{globalSettings.copies}</span>
                      <button
                        onClick={() => { const v = Math.min(500, globalSettings.copies + 1); updateSettingsFor(null, { copies: v, copiesInput: String(v) }); }}
                        disabled={globalSettings.copies >= 500}
                        className="w-12 h-12 flex items-center justify-center rounded-xl bg-secondary hover:bg-primary hover:text-black transition-all duration-200 disabled:opacity-30 disabled:hover:bg-secondary disabled:hover:text-foreground active:scale-95"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {/* Global Sides */}
                  <div>
                    <h3 className="text-lg font-semibold mb-4">Global Sides</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => updateSettingsFor(null, { duplex: false })}
                        className={`group flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all duration-200 outline-none
                          ${!globalSettings.duplex
                            ? 'border-primary bg-primary/5 shadow-[0_0_20px_rgba(var(--primary-rgb),0.15)] scale-[1.02]'
                            : 'border-border bg-card hover:border-primary/40 hover:bg-primary/5 hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(var(--primary-rgb),0.1)] text-muted-foreground'}`}
                      >
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-3 transition-all duration-200
                          ${!globalSettings.duplex ? 'bg-primary text-black shadow-md' : 'bg-secondary group-hover:bg-primary/20 group-hover:text-foreground'}`}>
                          <Layers className="w-5 h-5" />
                        </div>
                        <span className="font-bold text-sm">Single Side</span>
                      </button>
                      <button
                        onClick={() => updateSettingsFor(null, { duplex: true })}
                        className={`group flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all duration-200 outline-none
                          ${globalSettings.duplex
                            ? 'border-primary bg-primary/5 shadow-[0_0_20px_rgba(var(--primary-rgb),0.15)] scale-[1.02]'
                            : 'border-border bg-card hover:border-primary/40 hover:bg-primary/5 hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(var(--primary-rgb),0.1)] text-muted-foreground'}`}
                      >
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-3 transition-all duration-200
                          ${globalSettings.duplex ? 'bg-primary text-black shadow-md' : 'bg-secondary group-hover:bg-primary/20 group-hover:text-foreground'}`}>
                          <Layers className="w-5 h-5" />
                        </div>
                        <span className="font-bold text-sm">Double Side</span>
                      </button>
                    </div>
                  </div>

                  {/* Global Orientation */}
                  {globalSettings.paperSize !== 'a3' && (
                    <div>
                      <h3 className="text-lg font-semibold mb-4">Global Orientation</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <button
                          onClick={() => updateSettingsFor(null, { orientation: 'portrait' })}
                          className={`group flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all duration-200 outline-none
                            ${globalSettings.orientation === 'portrait'
                              ? 'border-primary bg-primary/5 shadow-[0_0_20px_rgba(var(--primary-rgb),0.15)] scale-[1.02]'
                              : 'border-border bg-card hover:border-primary/40 hover:bg-primary/5 hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(var(--primary-rgb),0.1)] text-muted-foreground'}`}
                        >
                          <div className={`w-8 h-12 rounded-md border-2 mb-3 transition-all duration-200
                            ${globalSettings.orientation === 'portrait' ? 'border-primary bg-primary/10' : 'border-muted-foreground/30 group-hover:border-primary/40'}`} />
                          <span className="font-bold text-sm">Portrait</span>
                        </button>
                        <button
                          onClick={() => updateSettingsFor(null, { orientation: 'landscape' })}
                          className={`group flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all duration-200 outline-none
                            ${globalSettings.orientation === 'landscape'
                              ? 'border-primary bg-primary/5 shadow-[0_0_20px_rgba(var(--primary-rgb),0.15)] scale-[1.02]'
                              : 'border-border bg-card hover:border-primary/40 hover:bg-primary/5 hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(var(--primary-rgb),0.1)] text-muted-foreground'}`}
                        >
                          <div className={`w-12 h-8 rounded-md border-2 mb-3 transition-all duration-200
                            ${globalSettings.orientation === 'landscape' ? 'border-primary bg-primary/10' : 'border-muted-foreground/30 group-hover:border-primary/40'}`} />
                          <span className="font-bold text-sm">Landscape</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Global Paper Size */}
                  <div>
                    <h3 className="text-lg font-semibold mb-4">Paper Size</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => updateSettingsFor(null, { paperSize: 'a4' })}
                        className={`group flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all duration-200 outline-none
                          ${globalSettings.paperSize === 'a4'
                            ? 'border-primary bg-primary/5 shadow-[0_0_20px_rgba(var(--primary-rgb),0.15)] scale-[1.02]'
                            : 'border-border bg-card hover:border-primary/40 hover:bg-primary/5 hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(var(--primary-rgb),0.1)] text-muted-foreground'}`}
                      >
                        <div className={`w-7 h-10 rounded-sm border-2 mb-3 transition-all duration-200
                          ${globalSettings.paperSize === 'a4' ? 'border-primary bg-primary/10' : 'border-muted-foreground/30 group-hover:border-primary/40'}`} />
                        <span className="font-bold text-sm">A4</span>
                      </button>
                      <button
                        onClick={() => updateSettingsFor(null, { paperSize: 'a3' })}
                        className={`group flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all duration-200 outline-none
                          ${globalSettings.paperSize === 'a3'
                            ? 'border-primary bg-primary/5 shadow-[0_0_20px_rgba(var(--primary-rgb),0.15)] scale-[1.02]'
                            : 'border-border bg-card hover:border-primary/40 hover:bg-primary/5 hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(var(--primary-rgb),0.1)] text-muted-foreground'}`}
                      >
                        <div className={`w-10 h-14 rounded-sm border-2 mb-3 transition-all duration-200
                          ${globalSettings.paperSize === 'a3' ? 'border-primary bg-primary/10' : 'border-muted-foreground/30 group-hover:border-primary/40'}`} />
                        <span className="font-bold text-sm text-center">A3<br/><span className="text-[10px] opacity-70">Booklet / Exam Paper</span></span>
                      </button>
                      </div>
                    </div>
                    </div>
                  )}
                </div>

                {/* Preview Modal */}
                <AnimatePresence>
                  {previewFileIndex !== null && fileDetailsList[previewFileIndex] && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                      onClick={() => setPreviewFileIndex(null)}
                    >
                      <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.9, opacity: 0 }}
                        onClick={(e) => e.stopPropagation()}
                        /* A3 sheets are landscape and carry two pages, so give them a wider
                           dialog — at the portrait width the two halves are too small to
                           actually check anything on. */
                        className={`bg-card rounded-3xl shadow-2xl w-full max-h-[80vh] overflow-hidden flex flex-col ${
                          getSettingsFor(previewFileIndex).paperSize === 'a3'
                            ? 'max-w-4xl'
                            : 'max-w-2xl'
                        }`}
                      >
                        <div className="p-5 border-b border-border flex items-center justify-between">
                          <div>
                            <h3 className="font-bold text-lg">{fileDetailsList[previewFileIndex].fileName}</h3>
                            <p className="text-xs text-muted-foreground mt-1">
                              {(() => {
                                const s = getSettingsFor(previewFileIndex);
                                // A3 always prints as a folded booklet, which is landscape and
                                // double-sided regardless of what the orientation and duplex
                                // controls say — reporting "Portrait · Single-sided" next to a
                                // landscape booklet preview just looked wrong.
                                const isBook = s.paperSize === 'a3';
                                const sides = isBook ? 'Double-sided' : s.duplex ? 'Double-sided' : 'Single-sided';
                                const layout = isBook ? 'Booklet' : s.orientation === 'portrait' ? 'Portrait' : 'Landscape';
                                return `${s.copies} cop${s.copies > 1 ? 'ies' : 'y'} · ${s.colorMode === 'bw' ? 'B&W' : 'Color'} · ${sides} · ${layout} · ${s.paperSize === 'a3' ? 'A3' : 'A4'} · ${s.pageRangeMode === 'all' ? 'All pages' : s.pageRangeMode === 'custom' ? `Pages: ${s.customRange}` : `${s.pageRangeMode} pages`}`;
                              })()}
                            </p>
                          </div>
                          <button
                            onClick={() => setPreviewFileIndex(null)}
                            className="w-10 h-10 flex items-center justify-center rounded-full bg-secondary hover:bg-red-100 hover:text-red-600 transition-colors"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                        <div className="flex-1 overflow-auto p-5 flex items-center justify-center min-h-[300px]">
                          {(() => {
                            const fd = fileDetailsList[previewFileIndex];
                            const ext = fd.fileName.toLowerCase().split('.').pop() || '';
                            const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'jfif', 'svg', 'tiff', 'tif', 'heic', 'avif'].includes(ext);
                            const isPdf = ext === 'pdf';
                            const isOffice = ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'odt', 'ods', 'odp'].includes(ext);
                            const settings = getSettingsFor(previewFileIndex);

                            // Paper dimensions for visual frame (aspect ratios).
                            // Every A3 job is imposed as a booklet by the print agent —
                            // Office files and images are converted to PDF first and then
                            // imposed exactly like a PDF — so the physical sheet is ALWAYS
                            // landscape A3 carrying two A4 pages per side, whatever was
                            // uploaded. This used to be gated on isPdf, which left a Word
                            // document previewing as a portrait page while the printer
                            // produced a landscape booklet. Portrait A3 and portrait A4
                            // share the same 1:√2 ratio, so the frame was also visually
                            // identical to A4 and the size change looked like it did
                            // nothing at all.
                            const isA3 = settings.paperSize === 'a3';
                            // Every A3 job is imposed as a booklet, so the preview always shows
                            // the folded sheet the printer actually produces — no separate
                            // "raw document" view to toggle to.
                            const isBooklet = isA3;
                            const isLandscape = isBooklet ? true : settings.orientation === 'landscape';
                            // A4 = 210x297mm, A3 = 297x420mm
                            const paperW = isLandscape ? (isA3 ? 420 : 297) : (isA3 ? 297 : 210);
                            const paperH = isLandscape ? (isA3 ? 297 : 210) : (isA3 ? 420 : 297);
                            const frameMaxH = isA3 ? '62vh' : '55vh';
                            const frameMaxW = isA3 ? (isLandscape ? '700px' : '520px') : (isLandscape ? '600px' : '420px');

                            const paperFrame = (content: React.ReactNode) => (
                              <div className="relative flex flex-col items-center w-full">
                                <div
                                  className="relative bg-white border-2 border-gray-200 rounded-lg shadow-xl overflow-hidden flex items-center justify-center transition-all duration-300"
                                  style={{
                                    aspectRatio: `${paperW} / ${paperH}`,
                                    maxHeight: frameMaxH,
                                    maxWidth: frameMaxW,
                                    width: '100%',
                                  }}
                                >
                                  {content}
                                  {/* Centre fold — where the sheet is folded to make the booklet */}
                                  {isBooklet && (
                                    <div
                                      className="absolute inset-y-0 left-1/2 z-10 pointer-events-none border-l border-dashed border-gray-300"
                                      aria-hidden="true"
                                    />
                                  )}
                                  {/* Paper size label */}
                                  <div className="absolute bottom-2 right-3 bg-black/5 backdrop-blur-sm text-[10px] font-bold text-muted-foreground px-2 py-0.5 rounded-md uppercase tracking-wider z-10">
                                    {settings.paperSize.toUpperCase()} · {isBooklet ? 'Booklet' : isLandscape ? 'Landscape' : 'Portrait'}
                                  </div>
                                </div>
                                {isBooklet && (
                                  <p className="mt-3 text-xs text-muted-foreground text-center max-w-md">
                                    Folded booklet — one A3 sheet, two A4 pages per side, printed
                                    double-sided on the short edge. Page 1 sits on the right of the
                                    front sheet; the last page faces it on the left.
                                  </p>
                                )}
                              </div>
                            );

                            // On a booklet sheet the first page lands on the right half of the
                            // front side; the left half is the last page. Anything that cannot
                            // be imposed in the browser is drawn into that slot, so the preview
                            // matches where the content actually comes out.
                            //
                            // Each half of a landscape A3 sheet is exactly A4 portrait, so a
                            // slot simply fills its half — no padding or aspect ratio, both of
                            // which only pushed the page over the fold.
                            const pageSlot = (content: React.ReactNode, label?: string) => (
                              <div className="relative h-full w-full overflow-hidden bg-white">
                                {content}
                                {label && (
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground/40">
                                      {label}
                                    </span>
                                  </div>
                                )}
                              </div>
                            );

                            const onSheet = (content: React.ReactNode) =>
                              isBooklet ? (
                                <div className="w-full h-full flex">
                                  <div className="w-1/2 h-full">{pageSlot(null, 'Last page')}</div>
                                  <div className="w-1/2 h-full">{pageSlot(content)}</div>
                                </div>
                              ) : (
                                content
                              );

                            if (isImg) {
                              if (isLoadingDirectPreview) {
                                return paperFrame(
                                  <div className="w-full h-full flex items-center justify-center">
                                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                                  </div>
                                );
                              }
                              return paperFrame(
                                onSheet(
                                  <img
                                    src={directPreviewUrl ?? fd.filePath}
                                    alt={fd.fileName}
                                    className={`w-full h-full object-contain p-3 ${settings.colorMode === 'bw' ? 'grayscale' : ''}`}
                                  />
                                )
                              );
                            }
                            if (isPdf) {
                              if (isBooklet) {
                                if (isGeneratingBooklet) {
                                  return paperFrame(
                                    <div className="w-full h-full flex flex-col items-center justify-center space-y-4">
                                      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                                      <p className="text-sm font-medium text-muted-foreground animate-pulse">Generating Booklet Layout...</p>
                                    </div>
                                  );
                                }
                                if (bookletPreviewUrl) {
                                  return paperFrame(
                                    <iframe
                                      src={`${bookletPreviewUrl}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`}
                                      className={`w-full h-full border-0 ${settings.colorMode === 'bw' ? 'grayscale' : ''}`}
                                      title={`Preview Booklet ${fd.fileName}`}
                                    />
                                  );
                                }
                              }
                              if (isLoadingDirectPreview) {
                                return paperFrame(
                                  <div className="w-full h-full flex flex-col items-center justify-center space-y-4">
                                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                                    <p className="text-sm font-medium text-muted-foreground animate-pulse">Loading preview...</p>
                                  </div>
                                );
                              }
                              if (directPreviewUrl) {
                                return paperFrame(
                                  onSheet(
                                    <iframe
                                      src={`${directPreviewUrl}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`}
                                      className={`w-full h-full border-0 ${settings.colorMode === 'bw' ? 'grayscale' : ''}`}
                                      title={`Preview ${fd.fileName}`}
                                    />
                                  )
                                );
                              }
                              return paperFrame(
                                onSheet(
                                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 px-4 text-center">
                                    <FileText className="w-10 h-10 text-primary/30" />
                                    <p className="text-[11px] font-semibold text-foreground/70 line-clamp-2 break-all">
                                      {fd.fileName}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground/60">
                                      Preview unavailable — will print as uploaded.
                                    </p>
                                  </div>
                                )
                              );
                            }
                            if (isOffice) {
                              // Word/PowerPoint/Excel can't be rendered by the browser directly,
                              // and previewing them used to route through Google's unofficial
                              // gview endpoint. That is not a service Google supports or
                              // guarantees: depending on the viewer's network and browser
                              // settings it sometimes fails to render and just downloads the
                              // raw file instead of showing anything — confusing on a shared
                              // lab machine with no warning it was ever a preview. Always
                              // showing this card instead is less flashy but never surprises
                              // anyone; the document itself still prints exactly as uploaded.
                              return paperFrame(
                                onSheet(
                                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 px-4 text-center">
                                    <FileText className="w-10 h-10 text-primary/30" />
                                    <p className="text-[11px] font-semibold text-foreground/70 line-clamp-2 break-all">
                                      {fd.fileName}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground/60">
                                      {isBooklet ? 'Page 1 — preview unavailable for this format.' : 'Preview unavailable — will print as uploaded.'}
                                    </p>
                                  </div>
                                )
                              );
                            }
                            // Fallback: try rendering as image first (covers edge cases), with file info overlay
                            return paperFrame(
                              onSheet(
                              <div className="w-full h-full flex flex-col items-center justify-center relative">
                                <img
                                  src={fd.filePath}
                                  alt={fd.fileName}
                                  className={`w-full h-full object-contain p-3 ${settings.colorMode === 'bw' ? 'grayscale' : ''}`}
                                  onError={(e) => {
                                    // If image fails to load, show file info instead
                                    const target = e.currentTarget;
                                    target.style.display = 'none';
                                    const fallback = target.nextElementSibling as HTMLElement;
                                    if (fallback) fallback.style.display = 'flex';
                                  }}
                                />
                                <div className="hidden flex-col items-center justify-center text-center text-muted-foreground space-y-3 p-6 absolute inset-0">
                                  <FileText className="w-14 h-14 text-primary/30" />
                                  <p className="font-bold text-foreground text-base">{fd.fileName}</p>
                                  <p className="text-xs text-muted-foreground">{fd.pageCount} page{fd.pageCount > 1 ? 's' : ''} · Will be printed as shown</p>
                                </div>
                              </div>
                              )
                            );
                          })()}
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

{/* Floating Bottom Bar */}
                <div className="mt-12 bg-card border border-border rounded-3xl p-6 shadow-soft flex flex-col sm:flex-row items-center justify-between gap-6">
                  <div>
                    <p className="text-muted-foreground text-sm font-medium mb-1">Ready to Print</p>
                    <div className="flex items-end gap-1">
                      {(() => {
                        // Pages actually printed, not pages in the source file — a
                        // 1-page document set to 5 copies is 5 sheets, and that is
                        // the number worth being aware of before submitting.
                        const totalPages = fileDetailsList.reduce(
                          (sum, fd, idx) => sum + fd.pageCount * getSettingsFor(idx).copies,
                          0
                        );
                        return (
                          <span className="text-2xl font-display font-bold leading-none">
                            {totalPages} page{totalPages !== 1 ? 's' : ''}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                  <Button
                    size="lg"
                    className="w-full sm:w-auto min-w-[200px]"
                    onClick={handleCreateJob}
                    isLoading={createJobMutation.isPending}
                  >
                    {createJobMutation.isPending ? 'Preparing Job...' : 'Submit Print Job'}
                  </Button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </Layout>
  );
}
