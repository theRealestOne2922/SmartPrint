import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { usePrintJob } from "@/hooks/use-print";
import { Button } from "@/components/button";
import { Link } from "wouter";
import { CheckCircle2, Copy, MapPin, Printer, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

export default function JobStatus() {
  const [, setLocation] = useLocation();
  const [jobId, setJobId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const storedJobId = sessionStorage.getItem("current_job_id");
    if (storedJobId) {
      setJobId(storedJobId);
    } else {
      setLocation("/print");
    }
  }, [setLocation]);

  const { data: jobs, isLoading, isError } = usePrintJob(jobId);
  const teacherEmail = typeof window !== 'undefined' ? localStorage.getItem("teacherEmail") : null;

  const copyToClipboard = () => {
    if (jobId) {
      navigator.clipboard.writeText(jobId);
      toast({
        title: "Copied to clipboard",
        description: "You can now paste your code.",
      });
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (isError || !jobs || jobs.length === 0) {
    return (
      <Layout>
        <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto text-center px-4">
          <AlertCircle className="w-16 h-16 text-destructive mb-6" />
          <h2 className="text-3xl font-bold mb-4">Job Not Found</h2>
          <p className="text-muted-foreground mb-8 text-balance">
            We couldn't find a print job with that code. It may have expired or been printed already.
          </p>
          <Link href="/print">
            <Button size="lg">Upload a New Document</Button>
          </Link>
        </div>
      </Layout>
    );
  }

  const totalPages = jobs.reduce((sum, job) => sum + job.pageCount, 0);
  const isMultiFile = jobs.length > 1;

  return (
    <Layout>
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 max-w-lg mx-auto w-full">

        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", bounce: 0.5 }}
          className="w-20 h-20 bg-green-100 text-green-500 rounded-full flex items-center justify-center mb-8"
        >
          <CheckCircle2 className="w-10 h-10" />
        </motion.div>

        <h1 className="text-3xl font-bold text-center mb-2">Ready to Print!</h1>
        <p className="text-center text-muted-foreground mb-8">
          {isMultiFile ? `${jobs.length} documents are securely stored.` : 'Your document is securely stored.'}
        </p>

        {/* Massive ID Card or Email Notice */}
        {teacherEmail ? (
          <div className="w-full bg-primary/10 border-2 border-primary/20 rounded-[2rem] p-8 text-center relative shadow-soft overflow-hidden mb-8">
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4 text-primary shadow-sm">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Check Your Email</h2>
            <p className="text-muted-foreground text-balance">
              Your 6-digit Print Code has been sent to <strong>{teacherEmail}</strong> for security purposes.
            </p>
          </div>
        ) : (
          <div className="w-full bg-card border-2 border-primary/20 rounded-[2rem] p-8 text-center relative shadow-soft overflow-hidden mb-8">
            <div className="absolute top-0 left-0 w-full h-2 bg-primary" />
            <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Your Print Code</p>

            <div className="flex items-center justify-center gap-4 mb-2">
              <h2 className="text-6xl sm:text-7xl font-display font-bold tracking-widest text-foreground">
                {jobId}
              </h2>
            </div>

            <button
              onClick={copyToClipboard}
              className="inline-flex items-center gap-2 text-primary-foreground bg-foreground/5 hover:bg-foreground/10 px-4 py-2 rounded-full text-sm font-medium transition-colors mt-6"
            >
              <Copy className="w-4 h-4" /> Copy Code
            </button>
          </div>
        )}

        {/* Receipt Details */}
        <div className="w-full bg-secondary/50 rounded-2xl p-6 mb-10 border border-border/50">
          <h3 className="font-semibold mb-4 border-b border-border/50 pb-4">Job Summary</h3>
          <div className="space-y-3 text-sm">
            {isMultiFile ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Documents</span>
                <span className="font-medium text-right">{jobs.length} Files</span>
              </div>
            ) : (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Document</span>
                <span className="font-medium truncate max-w-[200px]" title={jobs[0].fileName}>{jobs[0].fileName}</span>
              </div>
            )}
            
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Pages</span>
              <span className="font-medium">{totalPages}</span>
            </div>
            
            {!isMultiFile && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Format</span>
                <span className="font-medium">{jobs[0].copies}x {jobs[0].colorMode === 'bw' ? 'B&W' : 'Color'}</span>
              </div>
            )}
            
          </div>
        </div>

        {/* Next steps indicator */}
        <div className="w-full space-y-4">
          <div className="flex items-center gap-4 p-4 bg-card rounded-2xl border border-border shadow-sm">
            <div className="w-12 h-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center shrink-0">
              <MapPin className="w-6 h-6" />
            </div>
            <div>
              <p className="font-semibold">1. Go to any Kiosk</p>
              <p className="text-sm text-muted-foreground">Find a SmartPrint station near you.</p>
            </div>
          </div>
          <div className="flex items-center gap-4 p-4 bg-card rounded-2xl border border-border shadow-sm">
            <div className="w-12 h-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center shrink-0">
              <Printer className="w-6 h-6" />
            </div>
            <div>
              <p className="font-semibold">2. Enter Code & Print</p>
              <p className="text-sm text-muted-foreground">
                {teacherEmail
                  ? "Enter the code from your email on the screen to release the print."
                  : `Enter ${jobId} on the screen to release the print.`}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-12 text-center w-full">
          <Link href="/">
            <Button variant="ghost" className="w-full">Print Another Document</Button>
          </Link>
        </div>
      </div>
    </Layout>
  );
}
