// Print Hooks — MongoDB Edition
// All reads/writes go through the Express API; uploads POST to /api/upload,
// which stores the file on the backend's local disk.
import { useMutation, useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/lib/api-config";
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';

// Uploading and creating jobs now require a signed-in member of staff, and the
// server takes the faculty identity from this token rather than from anything
// the page sends — so a job can only ever be created as the person holding it.
function teacherAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("teacherToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

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
        headers: teacherAuthHeaders(),
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

// The server allocates the code and guarantees uniqueness. It used to be
// generated here and probed via a check-unique endpoint, which doubled as a
// way for anyone to test whether a given code was live.
export async function getUniqueJobId(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/print-jobs/new-code`, { method: 'POST' });
  if (!res.ok) {
    throw new Error('Could not get a print code. Please try again.');
  }
  const { jobId } = await res.json();
  if (!jobId) {
    throw new Error('Could not get a print code. Please try again.');
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

      // Create job via Express API (was: direct Supabase insert)
      const res = await fetch(`${API_BASE}/api/print-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...teacherAuthHeaders() },
        // studentName, teacherEmpId and teacherEmail are deliberately not sent.
        // The server reads them from the signed-in account; sending them was
        // what allowed a job to be created under someone else's faculty ID.
        body: JSON.stringify({
          jobId,
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

// jobId is null until the caller reads it out of sessionStorage; the query
// stays disabled until then, so callers don't need to narrow it first.
export function usePrintJob(jobId: string | null) {
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
