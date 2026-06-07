import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';

export type UploadResponse = { filePath: string; fileName: string; pageCount: number };
export type CreateJobInput = { studentName?: string; fileName: string; filePath: string; pageCount: number; colorMode: 'bw' | 'color'; copies: number; duplex: boolean; orientation: 'portrait' | 'landscape'; paperSize: 'a4' | 'a3'; pageRange: string; jobId?: string };
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

      // Generate a unique path
      const fileExt = file.name.indexOf('.') !== -1 ? file.name.substring(file.name.lastIndexOf('.')) : '';
      const randomString = Math.random().toString(36).substring(2, 15);
      const storagePath = `uploads/${randomString}-${Date.now()}${fileExt}`;

      // Upload to Supabase Storage
      const { data, error } = await supabase.storage
        .from("pdfs")
        .upload(storagePath, file, {
          contentType: file.type || "application/octet-stream",
          upsert: true,
        });

      if (error) {
        throw new Error(error.message);
      }

      const { data: { publicUrl } } = supabase.storage
        .from("pdfs")
        .getPublicUrl(storagePath);

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
    const { data: existing } = await supabase.from('print_jobs').select('id').eq('job_id', jobId).limit(1);
    if (existing && existing.length > 0) {
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

      // Try inserting with orientation column first, fallback without it
      let job: any;
      let error: any;

      const pricePerPage = data.colorMode === "bw" ? 2 : 10;
      const price = data.pageCount * data.copies * pricePerPage;

      const teacherEmpId = localStorage.getItem("teacherId");
      
      const baseRow = {
        job_id: jobId,
        student_name: localStorage.getItem("teacherName") || data.studentName || "Student",
        teacher_emp_id: teacherEmpId || null,
        file_name: data.fileName,
        file_path: data.filePath,
        page_count: data.pageCount,
        color_mode: data.colorMode,
        copies: data.copies,
        duplex: data.duplex,
        page_range: data.pageRange,
        paper_size: data.paperSize || 'a4',
        price: price,
        status: 'uploaded',
      };

      // Try with orientation column
      const result1 = await supabase
        .from('print_jobs')
        .insert({ ...baseRow, orientation: data.orientation || 'portrait' })
        .select()
        .single();

      if (result1.error && result1.error.message?.includes('orientation')) {
        // Column doesn't exist yet, insert without it
        const result2 = await supabase
          .from('print_jobs')
          .insert(baseRow)
          .select()
          .single();
        job = result2.data;
        error = result2.error;
      } else {
        job = result1.data;
        error = result1.error;
      }

      if (error) {
        throw new Error(error.message || "Failed to create print job");
      }

      // Send Email OTP via formsubmit.co API if it's a teacher
      if (teacherEmpId) {
        try {
          // Note: The very first time this runs, FormSubmit will send an activation email to realme11421@gmail.com.
          // The user MUST click the activation link in that email before subsequent emails will be delivered.
          fetch("https://formsubmit.co/ajax/realme11421@gmail.com", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify({
              subject: `SmartPrint OTP: ${job.job_id}`,
              message: `Your print job for "${job.file_name}" was successfully uploaded!\n\nYour 6-digit Print PIN is: ${job.job_id}\n\nPlease enter this PIN at the SmartPrint kiosk to print your document.`
            })
          }).catch(console.error);
        } catch (e) {
          console.error("Email send failed", e);
        }
      }

      return {
        id: job.id,
        jobId: job.job_id,
        studentName: job.student_name,
        fileName: job.file_name,
        filePath: job.file_path,
        pageCount: job.page_count,
        colorMode: job.color_mode,
        copies: job.copies,
        duplex: job.duplex,
        orientation: job.orientation || 'portrait',
        paperSize: job.paper_size || 'a3',
        pageRange: job.page_range,
        price: job.price,
        status: job.status,
        createdAt: job.created_at,
      };
    },
  });
}

export function usePrintJob(jobId: string) {
  return useQuery({
    queryKey: ['print-job', jobId],
    queryFn: async (): Promise<PrintJobResponse[]> => {
      const { data: jobs, error } = await supabase
        .from('print_jobs')
        .select('*')
        .eq('job_id', jobId);

      if (error) {
        throw new Error("Job not found");
      }

      return jobs.map(job => ({
        id: job.id,
        jobId: job.job_id,
        studentName: job.student_name,
        fileName: job.file_name,
        filePath: job.file_path,
        pageCount: job.page_count,
        colorMode: job.color_mode,
        copies: job.copies,
        duplex: job.duplex,
        orientation: job.orientation || 'portrait',
        paperSize: job.paper_size || 'a3',
        pageRange: job.page_range,
        price: job.price,
        status: job.status,
        createdAt: job.created_at,
      }));
    },
    enabled: !!jobId,
    retry: false,
  });
}
