import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { usePrintJob, useUpdatePrintJobStatus } from "@/hooks/use-print-jobs";
import { PageTransition } from "@/components/PageTransition";
import { motion } from "framer-motion";
import { X } from "lucide-react";

// Seconds this screen waits before actually sending the job to the printer.
//
// This pause is the entire cancel feature. Once the job is released the Pi
// claims it within about a second, and only the Pi can talk to CUPS — nothing
// the website writes afterwards can call the paper back. So the one moment a
// cancel is completely reliable is while the job has not been sent at all.
const SEND_DELAY_SECONDS = 5;

export function PrintingScreen() {
  const params = useParams<{ printId: string }>();
  const [, setLocation] = useLocation();
  const printId = params?.printId || "";
  const hasTriggered = useRef(false);
  const hasReleased = useRef(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Poll rapidly during printing
  const { data: jobs } = usePrintJob(printId, 1500);
  const updateStatus = useUpdatePrintJobStatus();

  // THIS IS THE CRITICAL TRIGGER: When this screen loads and the job is
  // at 'payment_confirmed' OR 'uploaded', we fire the status change to 'printing'.
  // This is what tells the Pi Agent to download and print the document.
  //
  // It now starts a short countdown first rather than firing immediately, so
  // there is a window in which Cancel genuinely stops the job.
  useEffect(() => {
    if (cancelling) return;
    if (jobs && jobs.length > 0 && !updateStatus.isPending) {
      // If ANY job in the batch needs to be triggered, we update the whole batch
      const needsTrigger = jobs.some(j => j.status === 'payment_confirmed' || j.status === 'uploaded');
      if (needsTrigger && !hasTriggered.current) {
        hasTriggered.current = true;
        setCountdown(SEND_DELAY_SECONDS);

        // One timer decides when the job is sent, started once and never
        // rescheduled. The visible countdown below is decoration driven by a
        // separate interval — deliberately, so that if the display logic ever
        // misbehaves the job still prints on time. Tying the release to a
        // per-second effect would mean any stall in that effect stops printing
        // altogether, which is not a failure an unattended kiosk should have.
        releaseTimer.current = setTimeout(() => releaseRef.current(), SEND_DELAY_SECONDS * 1000);
        // Floors at 1 rather than counting itself out: the release timer is what
        // ends the countdown, so the Cancel button stays available right up to
        // the moment the job is actually sent instead of vanishing a second
        // early.
        ticker.current = setInterval(() => {
          setCountdown((c) => (c === null ? null : Math.max(1, c - 1)));
        }, 1000);
      }
    }
  }, [jobs, printId, updateStatus, cancelling]);

  // Stop both timers if the screen goes away mid-countdown.
  useEffect(() => () => {
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    if (ticker.current) clearInterval(ticker.current);
  }, []);

  // Reached through a ref because useMutation returns a fresh object on every
  // render and this screen re-renders on each 1.5s poll — capturing it directly
  // in a timer would mean firing a stale closure.
  const releaseRef = useRef<() => void>(() => {});
  releaseRef.current = () => {
    if (hasReleased.current) return;
    hasReleased.current = true;
    if (ticker.current) clearInterval(ticker.current);
    setCountdown(null);
    updateStatus.mutate(
      { printId, status: 'printing' },
      {
        // Without this the screen spins indefinitely on a rejected release — a
        // confidential job opened directly without faculty verification, say.
        // The error screen returns the kiosk to idle by itself after a few
        // seconds, which is what an unattended machine needs.
        onError: () => setLocation("/error"),
      },
    );
  };

  // Nothing has been sent while the countdown is running, so cancelling is just
  // a matter of not sending it. The job stays 'uploaded' and the same print code
  // can be entered again.
  const handleCancel = () => {
    hasReleased.current = true; // also stops the pending release timer's effect
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    if (ticker.current) clearInterval(ticker.current);
    setCancelling(true);
    setCountdown(null);
    setLocation("/");
  };

  useEffect(() => {
    if (jobs && jobs.length > 0) {
      // Check if ALL jobs are done
      const allCompleted = jobs.every(j => j.status === 'completed');
      // 'cancelled' has to count as finished here. This screen used to leave on
      // all-completed, or all-finished-with-a-failure, and nothing else — so a
      // cancelled job matched neither condition and the printer animation span
      // forever with nobody able to get back to the idle screen.
      const isFinished = jobs.every(j => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled');
      const hasFailed = jobs.some(j => j.status === 'failed');
      const hasCancelled = jobs.some(j => j.status === 'cancelled');

      if (allCompleted) {
        setLocation("/success");
      } else if (isFinished && hasCancelled) {
        // A deliberate stop is not a fault, so it does not go to the error
        // screen. Checked before the failure case: a batch that was cancelled
        // mid-flight can leave some files 'failed', and the reason the user
        // cares about is the cancellation they asked for.
        setLocation("/cancelled");
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
          {countdown !== null
            ? `Sending to the printer in ${countdown}...`
            : "Please wait while we prepare your pages..."}
        </p>
        <p className="text-sm font-bold text-primary bg-primary/10 px-6 py-2 rounded-full">
          Do not leave the kiosk
        </p>

        {/* Only shown while the countdown is running, because that is the only
            time it can actually stop anything. Leaving a Cancel button on screen
            after the job has gone to the printer would be a button that lies. */}
        {countdown !== null && (
          <button
            onClick={handleCancel}
            data-testid="cancel-print"
            className="mt-5 touch-target-small rounded-full bg-secondary text-foreground text-lg font-bold px-8 py-3 hover:bg-gray-200 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <X className="w-5 h-5" />
            Cancel
          </button>
        )}
      </div>
    </PageTransition>
  );
}
