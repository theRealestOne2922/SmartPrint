import { useLocation, useParams } from "wouter";
import { usePrintJob, useUpdatePrintJobStatus, useUpdatePrintJobDetails, useDeletePrintJobItem } from "@/hooks/use-print-jobs";
import { PageTransition } from "@/components/PageTransition";
import { FileText, FileSearch, Loader2, ArrowLeft, CheckCircle2, Trash2, Plus, Minus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function JobConfirmationScreen() {
  const params = useParams<{ printId: string }>();
  const [, setLocation] = useLocation();
  const printId = params?.printId || "";

  const { data: jobs, isLoading, error } = usePrintJob(printId);
  const updateStatusMutation = useUpdatePrintJobStatus();
  const updateDetailsMutation = useUpdatePrintJobDetails();
  const deleteItemMutation = useDeletePrintJobItem();

  // Kiosk Drag-to-Scroll State
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [startY, setStartY] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!scrollRef.current) return;
    setIsPointerDown(true);
    setIsDragging(false); // don't drag until they move
    setStartY(e.pageY - scrollRef.current.offsetTop);
    setScrollTop(scrollRef.current.scrollTop);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isPointerDown || !scrollRef.current) return;
    const y = e.pageY - scrollRef.current.offsetTop;
    const walk = (y - startY);
    
    // If they moved more than 5px, we consider it a drag
    if (Math.abs(walk) > 5) {
      setIsDragging(true);
    }
    
    if (isDragging) {
      e.preventDefault(); 
      scrollRef.current.scrollTop = scrollTop - (walk * 1.5);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsPointerDown(false);
    // Delay resetting isDragging so the click event doesn't fire immediately
    setTimeout(() => setIsDragging(false), 50);
  };

  // Auto route based on state to prevent returning to confirmation for an already paid job
  useEffect(() => {
    if (jobs && jobs.length > 0) {
      const anyCompleted = jobs.some(j => j.status === 'completed');
      const anyPrinting = jobs.some(j => j.status === 'printing' || j.status === 'payment_confirmed');
      const allFailed = jobs.every(j => j.status === 'failed');

      if (anyCompleted) {
        setLocation(`/success`);
      } else if (anyPrinting) {
        setLocation(`/printing/${printId}`);
      } else if (allFailed) {
        setLocation(`/error`);
      }
    }
  }, [jobs, printId, setLocation]);

  if (isLoading) {
    return (
      <PageTransition className="items-center justify-center">
        <Loader2 className="w-24 h-24 animate-spin text-primary mb-8" />
        <h2 className="text-4xl font-display font-bold">Locating your document...</h2>
      </PageTransition>
    );
  }

  if (error || !jobs || jobs.length === 0) {
    return (
      <PageTransition className="items-center justify-center text-center">
        <div className="w-32 h-32 bg-red-100 rounded-full flex items-center justify-center mb-8 text-red-500 mx-auto">
          <FileSearch className="w-16 h-16" />
        </div>
        <h2 className="text-6xl font-display font-bold mb-6">Print ID Not Found</h2>
        <p className="text-2xl text-muted-foreground mb-12 max-w-2xl mx-auto">
          We couldn't find a print job matching the ID "{printId}". Please check your code and try again.
        </p>
        <button
          onClick={() => setLocation("/")}
          className="px-12 py-6 rounded-full bg-secondary hover:bg-gray-200 text-3xl font-bold transition-all"
        >
          Try Again
        </button>
      </PageTransition>
    );
  }

  const formatCost = (price: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR'
    }).format(price);
  };

  const totalPages = jobs.reduce((sum, job) => sum + (job.pageCount * job.copies), 0);
  const isMultiFile = jobs.length > 1;

  return (
    <PageTransition className="p-4 flex-1 flex flex-col min-h-0">
      <div className="max-w-4xl w-full mx-auto flex flex-col min-h-0 flex-1">
        <div className="text-center mb-4 shrink-0">
          <h2 className="text-4xl font-display font-bold mb-2">Confirm Print Details</h2>
          <p className="text-xl text-muted-foreground">Please review and adjust your document settings before releasing the print.</p>
        </div>

        <div className="bg-white kiosk-shadow rounded-[2rem] p-6 mb-4 flex-1 flex flex-col min-h-0">
          <div className="flex justify-between items-center border-b pb-3 mb-4 shrink-0">
            <span className="text-lg text-muted-foreground font-semibold">Uploaded by: <span className="text-black font-bold">{jobs[0].studentName || 'Teacher'}</span></span>
            <span className="text-lg text-muted-foreground font-semibold">Total Pages: <span className="text-black font-bold">{totalPages}</span></span>
          </div>

          <div 
            ref={scrollRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className={`flex-1 overflow-y-auto pr-2 space-y-4 ${isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'}`} 
            style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', touchAction: 'pan-y' }}
          >
            {jobs.map((job, idx) => (
              <div key={job.id || idx} className={`bg-gray-50 border border-gray-150 p-4 rounded-2xl flex flex-col gap-3 ${isDragging ? 'pointer-events-none' : ''}`}>
                <div className="flex justify-between items-center gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="w-8 h-8 text-primary shrink-0" />
                    <span className="font-bold text-xl truncate max-w-[450px]" title={job.fileName}>
                      {job.fileName}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm("Are you sure you want to remove this document from the print job?")) {
                        deleteItemMutation.mutate({ id: job.id, jobId: printId }, {
                          onSuccess: () => {
                            if (jobs.length <= 1) {
                              setLocation("/");
                            }
                          }
                        });
                      }
                    }}
                    className="p-3 text-red-500 hover:bg-red-50 rounded-full transition-colors active:scale-95 shrink-0"
                  >
                    <Trash2 className="w-6 h-6" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-4 border-t pt-3">
                  {/* Format (B&W vs Color) */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm text-gray-500 font-semibold">Format</span>
                    <div className="flex bg-gray-200 p-1 rounded-xl">
                      <button
                        onClick={() => updateDetailsMutation.mutate({ id: job.id, jobId: printId, updates: { colorMode: 'bw' } })}
                        className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${job.colorMode === 'bw' ? 'bg-primary text-black shadow-sm' : 'text-gray-500'}`}
                      >
                        B&W
                      </button>
                      <button
                        onClick={() => updateDetailsMutation.mutate({ id: job.id, jobId: printId, updates: { colorMode: 'color' } })}
                        className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${job.colorMode === 'color' ? 'bg-primary text-black shadow-sm' : 'text-gray-500'}`}
                      >
                        Color
                      </button>
                    </div>
                  </div>

                  {/* Copies */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm text-gray-500 font-semibold">Copies</span>
                    <div className="flex items-center gap-1.5 bg-gray-200 p-1 rounded-xl justify-between">
                      <button
                        onClick={() => updateDetailsMutation.mutate({ id: job.id, jobId: printId, updates: { copies: Math.max(1, job.copies - 1) } })}
                        className="w-9 h-9 flex items-center justify-center rounded-lg bg-white shadow-sm active:scale-90"
                      >
                        <Minus className="w-4 h-4 text-gray-700" />
                      </button>
                      <span className="font-bold text-base text-center flex-1">{job.copies}</span>
                      <button
                        onClick={() => updateDetailsMutation.mutate({ id: job.id, jobId: printId, updates: { copies: job.copies + 1 } })}
                        className="w-9 h-9 flex items-center justify-center rounded-lg bg-white shadow-sm active:scale-90"
                      >
                        <Plus className="w-4 h-4 text-gray-700" />
                      </button>
                    </div>
                  </div>

                  {/* Paper Size */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm text-gray-500 font-semibold">Paper Size</span>
                    <div className="flex bg-gray-200 p-1 rounded-xl">
                      <button
                        onClick={() => updateDetailsMutation.mutate({ id: job.id, jobId: printId, updates: { paperSize: 'a4' } })}
                        className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${(job.paperSize || 'a3') === 'a4' ? 'bg-primary text-black shadow-sm' : 'text-gray-500'}`}
                      >
                        A4
                      </button>
                      <button
                        onClick={() => updateDetailsMutation.mutate({ id: job.id, jobId: printId, updates: { paperSize: 'a3' } })}
                        className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${(job.paperSize || 'a3') === 'a3' ? 'bg-primary text-black shadow-sm' : 'text-gray-500'}`}
                      >
                        A3
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-4 shrink-0 pb-4">
          <button
            onClick={() => setLocation("/")}
            disabled={updateStatusMutation.isPending}
            className="flex-1 touch-target rounded-full bg-secondary text-foreground text-2xl font-bold hover:bg-gray-200 transition-all flex items-center justify-center gap-2 py-5 disabled:opacity-50"
          >
            <ArrowLeft className="w-7 h-7" />
            Cancel
          </button>
          <button
            onClick={() => {
              updateStatusMutation.mutate({ printId, status: 'printing' }, {
                onSuccess: () => setLocation(`/printing/${printId}`)
              });
            }}
            disabled={updateStatusMutation.isPending}
            className="flex-[2] touch-target rounded-full bg-primary text-black text-2xl font-bold hover:scale-[1.02] active:scale-95 transition-all kiosk-shadow flex items-center justify-center gap-2 py-5 disabled:opacity-50"
          >
            {updateStatusMutation.isPending ? "Releasing..." : "Release Print"}
            {!updateStatusMutation.isPending && <CheckCircle2 className="w-7 h-7" />}
          </button>
        </div>
      </div>
    </PageTransition>
  );
}
