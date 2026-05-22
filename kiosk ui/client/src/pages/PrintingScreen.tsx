import { useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { usePrintJob, useUpdatePrintJobStatus } from "@/hooks/use-print-jobs";
import { PageTransition } from "@/components/PageTransition";
import { motion } from "framer-motion";

export function PrintingScreen() {
  const params = useParams<{ printId: string }>();
  const [, setLocation] = useLocation();
  const printId = params?.printId || "";

  // Poll rapidly during printing
  const { data: jobs } = usePrintJob(printId, 1500);
  const updateStatus = useUpdatePrintJobStatus();

  // THIS IS THE CRITICAL TRIGGER: When this screen loads and the job is
  // at 'payment_confirmed' OR 'uploaded', we fire the status change to 'printing'.
  // This is what tells the Pi Agent to download and print the document.
  useEffect(() => {
    if (jobs && jobs.length > 0 && !updateStatus.isPending) {
      // If ANY job in the batch needs to be triggered, we update the whole batch
      const needsTrigger = jobs.some(j => j.status === 'payment_confirmed' || j.status === 'uploaded');
      if (needsTrigger) {
        console.log(`[KIOSK] Triggering print for batch ${printId}...`);
        updateStatus.mutate({ printId, status: 'printing' });
      }
    }
  }, [jobs, printId]);

  useEffect(() => {
    if (jobs && jobs.length > 0) {
      // Check if ALL jobs are done
      const allCompleted = jobs.every(j => j.status === 'completed');
      // If ALL are either completed or failed, and at least one is failed
      const isFinished = jobs.every(j => j.status === 'completed' || j.status === 'failed');
      const hasFailed = jobs.some(j => j.status === 'failed');

      if (allCompleted) {
        setLocation("/success");
      } else if (isFinished && hasFailed) {
        // If everything finished but something failed
        setLocation("/error");
      }
    }
  }, [jobs, setLocation]);

  const totalPages = jobs ? jobs.reduce((sum, job) => sum + job.pageCount, 0) : 0;
  const isMultiFile = jobs && jobs.length > 1;

  return (
    <PageTransition className="items-center justify-center p-4">
      <div className="max-w-3xl w-full text-center flex flex-col items-center">

        {/* Compact Animated Printer Graphic */}
        <div className="relative w-36 h-36 mb-5">
          <div className="absolute inset-0 bg-primary/20 rounded-full animate-pulse" />

          <motion.div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-18 h-18 bg-white border-3 border-gray-200 rounded-t-lg z-10"
            animate={{ y: [0, 22, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <div className="w-full h-full flex flex-col items-center pt-3 gap-1">
              <div className="w-10 h-1.5 bg-gray-200 rounded-full" />
              <div className="w-12 h-1.5 bg-gray-200 rounded-full" />
              <div className="w-8 h-1.5 bg-gray-200 rounded-full" />
            </div>
          </motion.div>

          <div className="absolute top-10 left-1/2 -translate-x-1/2 w-24 h-14 bg-primary rounded-lg z-20 shadow-lg flex items-center justify-center border-3 border-black">
            <div className="w-16 h-2.5 bg-black/20 rounded-full rounded-t-none" />
          </div>

          <motion.div
            className="absolute top-24 left-1/2 -translate-x-1/2 w-18 h-20 bg-white border-3 border-gray-200 rounded-b-lg z-30 shadow-xl origin-top"
            initial={{ scaleY: 0 }}
            animate={{ scaleY: [0, 1, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
          />
        </div>

        {/* Name + File info */}
        {jobs && jobs.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4"
          >
            <h2 className="text-3xl font-display font-bold mb-1">
              Printing for <span className="text-primary">{jobs[0].studentName || 'Student'}</span>
            </h2>
            <p className="text-lg text-muted-foreground">
              {isMultiFile ? `${jobs.length} Files` : jobs[0].fileName} • {totalPages} page{totalPages !== 1 ? 's' : ''}
            </p>
          </motion.div>
        )}

        {(!jobs || jobs.length === 0) && (
          <h2 className="text-3xl font-display font-bold mb-2">
            Printing Your Document
          </h2>
        )}

        <p className="text-sm text-muted-foreground mb-3">
          Please wait while we prepare your pages...
        </p>
        <p className="text-sm font-bold text-primary bg-primary/10 px-6 py-2 rounded-full">
          Do not leave the kiosk
        </p>
      </div>
    </PageTransition>
  );
}
