// ─── Print Hooks — MongoDB Edition ───
// Database queries now go through Express API instead of direct Supabase calls.
// Supabase client is kept ONLY for Storage uploads.
// Original version backed up in _supabase_backup/
import { useMutation, useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/lib/api-config";
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';

export type UploadResponse = { filePath: string; fileName: string; pageCount: number };
export type CreateJobInput = { studentName?: string; fileName: string; filePath: string; pageCount: number; colorMode: 'bw' | 'color'; copies: number; duplex: boolean; orientation: 'portrait' | 'landscape'; paperSize: 'a4' | 'a3'; pageRange: string; jobId?: string; confidential?: boolean; teacherEmail?: string };
export type PrintJobResponse = any;

/**
 * Extract page/slide count from Office XML documents.
 * DOCX/PPTX/XLSX are ZIP archives. Microsoft Office writes the exact
 * page/slide count into docProps/app.xml when saving the file.
 */
async function getOfficePageCount(file: File): Promise<number> {
  const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // --- Try docProps/app.xml (Word writes <Pages>, PowerPoint writes <Slides>) ---
    const appXmlFile = zip.file('docProps/app.xml');
    if (appXmlFile) {
      const appXml = await appXmlFile.async('text');

      // DOCX: <Pages>5</Pages>
      if (ext === '.docx' || ext === '.doc' || ext === '.odt') {
        const match = appXml.match(/<Pages>(\d+)<\/Pages>/);
        if (match) return Math.max(1, parseInt(match[1], 10));
      }

      // PPTX: <Slides>12</Slides>
      if (ext === '.pptx' || ext === '.ppt' || ext === '.odp') {
        const match = appXml.match(/<Slides>(\d+)<\/Slides>/);
        if (match) return Math.max(1, parseInt(match[1], 10));
      }
    }

    // --- Fallback: count slides by counting slide XML files in ppt/slides/ ---
    if (ext === '.pptx' || ext === '.ppt' || ext === '.odp') {
      const slideFiles = Object.keys(zip.files).filter(
        name => /^ppt\/slides\/slide\d+\.xml$/i.test(name)
      );
      if (slideFiles.length > 0) return slideFiles.length;
    }

    // --- Fallback: count worksheets for Excel ---
    if (ext === '.xlsx' || ext === '.xls' || ext === '.ods') {
      const sheetFiles = Object.keys(zip.files).filter(
        name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)
      );
      if (sheetFiles.length > 0) return sheetFiles.length;
    }

    // --- Fallback for DOCX: count document body sections ---
    if (ext === '.docx' || ext === '.doc') {
      const docXmlFile = zip.file('word/document.xml');
      if (docXmlFile) {
        const docXml = await docXmlFile.async('text');
        // Count section breaks (each <w:sectPr> roughly = 1 page section)
        // Not precise but better than 1
        const sections = (docXml.match(/<w:sectPr/g) || []).length;
        if (sections > 0) return sections;
      }
    }
  } catch (e) {
    console.error('Failed to extract Office page count:', e);
  }

  return 1; // Last resort fallback
}

export function useUploadFile() {
  return useMutation({
    mutationFn: async (file: File): Promise<UploadResponse> => {
      const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

      // Determine page count based on file type
      let pageCount = 1;

      if (ext === '.pdf' || file.type === 'application/pdf') {
        // PDF: use pdf-lib
        try {
          const arrayBuffer = await file.arrayBuffer();
          const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
          pageCount = pdfDoc.getPageCount();
        } catch (e) {
          console.error("Failed to parse PDF pages", e);
        }
      } else if (['.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.odt', '.odp', '.ods'].includes(ext)) {
        // Office/OpenDocument: extract from ZIP metadata
        pageCount = await getOfficePageCount(file);
      } else if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'].includes(ext)) {
        // Images are always 1 page
        pageCount = 1;
      }
      // .txt defaults to 1 (no reliable way to estimate without font metrics)

      // Upload directly to Express API
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${API_BASE}/api/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let errorMsg = "Upload failed";
        try {
          const errRes = await response.json();
          errorMsg = errRes.message || errorMsg;
        } catch (e) {
          // Fallback if not JSON
        }
        throw new Error(errorMsg);
      }

      const data = await response.json();
      const publicUrl = data.filePath;

      return {
        filePath: publicUrl,
        fileName: file.name,
        pageCount,
      };
    },
  });
}

export function generatePrintId(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function getUniqueJobId(): Promise<string> {
  const MAX_RETRIES = 20;
  let attempts = 0;
  let isUnique = false;
  let jobId = generatePrintId();
  while (!isUnique) {
    if (++attempts > MAX_RETRIES) {
      throw new Error('Failed to generate a unique job ID after maximum retries.');
    }
    // Check uniqueness via Express API (was: direct Supabase query)
    const res = await fetch(`${API_BASE}/api/print-jobs/check-unique/${jobId}`);
    const data = await res.json();
    if (data.exists) {
      jobId = generatePrintId();
    } else {
      isUnique = true;
    }
  }
  return jobId;
}

export function useCreatePrintJob() {
  return useMutation({
    mutationFn: async (data: CreateJobInput): Promise<PrintJobResponse> => {
      let jobId = data.jobId;
      if (!jobId) {
        jobId = await getUniqueJobId();
      }

      const pricePerPage = data.colorMode === "bw" ? 2 : 10;
      const price = data.pageCount * data.copies * pricePerPage;

      const teacherEmpId = localStorage.getItem("teacherId");
      const teacherEmail = localStorage.getItem("teacherEmail");

      // Create job via Express API (was: direct Supabase insert)
      const res = await fetch(`${API_BASE}/api/print-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          studentName: localStorage.getItem("teacherName") || data.studentName || "Student",
          teacherEmpId: teacherEmpId || null,
          teacherEmail: teacherEmail || null,
          fileName: data.fileName,
          filePath: data.filePath,
          pageCount: data.pageCount,
          colorMode: data.colorMode,
          copies: data.copies,
          duplex: data.duplex,
          orientation: data.orientation || 'portrait',
          paperSize: data.paperSize || 'a4',
          pageRange: data.pageRange,
          confidential: data.confidential || false,
          price,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create print job");
      }

      const job = await res.json();

      return job;
    },
  });
}

export function usePrintJob(jobId: string) {
  return useQuery({
    queryKey: ['print-job', jobId],
    queryFn: async (): Promise<PrintJobResponse[]> => {
      // Fetch via Express API (was: direct Supabase query)
      const res = await fetch(`${API_BASE}/api/print-jobs/${jobId}`);
      if (!res.ok) {
        throw new Error("Job not found");
      }

      const data = await res.json();
      // API may return a single job or an array
      return Array.isArray(data) ? data : [data];
    },
    enabled: !!jobId,
    retry: false,
  });
}
