import { useEffect, useState } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/button";
import { Link } from "wouter";
import { CheckCircle2, Copy, MapPin, Printer, FileText } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

interface BatchJob {
  jobId: string;
  fileName: string;
  pageCount: number;
  copies: number;
  colorMode: string;
  price: number;
}

export default function BatchStatus() {
  const { toast } = useToast();
  const [jobs, setJobs] = useState<BatchJob[]>([]);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('smartprint_batch_jobs');
      if (stored) {
        setJobs(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load batch jobs', e);
    }
  }, []);

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({
      title: "Copied!",
      description: `Code ${code} copied to clipboard.`,
    });
  };

  const copyAllCodes = () => {
    const allCodes = jobs.map(j => `${j.jobId} — ${j.fileName}`).join('\n');
    navigator.clipboard.writeText(allCodes);
    toast({
      title: "All codes copied!",
      description: `${jobs.length} print codes copied to clipboard.`,
    });
  };

  const totalPrice = jobs.reduce((sum, j) => sum + j.price, 0);

  if (jobs.length === 0) {
    return (
      <Layout>
        <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto text-center px-4">
          <h2 className="text-3xl font-bold mb-4">No Jobs Found</h2>
          <p className="text-muted-foreground mb-8">
            No recent batch print jobs found. Please upload your documents first.
          </p>
          <Link href="/print">
            <Button size="lg">Upload Documents</Button>
          </Link>
        </div>
      </Layout>
    );
  }

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

        <h1 className="text-3xl font-bold text-center mb-2">
          {jobs.length} File{jobs.length !== 1 ? 's' : ''} Ready!
        </h1>
        <p className="text-center text-muted-foreground mb-8">
          Each document has its own print code. Enter them at the kiosk.
        </p>

        {/* All Print Codes */}
        <div className="w-full space-y-3 mb-6">
          {jobs.map((job, index) => (
            <motion.div
              key={job.jobId}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1, duration: 0.3 }}
              className="w-full bg-card border-2 border-primary/20 rounded-2xl p-5 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-4 overflow-hidden min-w-0">
                <div className="w-10 h-10 bg-primary/10 text-primary rounded-xl flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate" title={job.fileName}>{job.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.pageCount} page{job.pageCount !== 1 ? 's' : ''} · {job.copies}x {job.colorMode === 'bw' ? 'B&W' : 'Color'} · ₹{job.price}
                  </p>
                </div>
              </div>
              <button
                onClick={() => copyCode(job.jobId)}
                className="flex items-center gap-2 bg-primary text-black font-bold text-lg px-4 py-2 rounded-xl hover:bg-primary/90 transition-colors shrink-0 ml-3"
              >
                {job.jobId}
                <Copy className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </div>

        {/* Copy All Button */}
        <button
          onClick={copyAllCodes}
          className="inline-flex items-center gap-2 text-primary bg-primary/10 hover:bg-primary/20 px-5 py-2.5 rounded-full text-sm font-semibold transition-colors mb-8"
        >
          <Copy className="w-4 h-4" /> Copy All Codes
        </button>

        {/* Total */}
        <div className="w-full bg-secondary/50 rounded-2xl p-5 mb-10 border border-border/50">
          <div className="flex justify-between items-center">
            <span className="font-semibold">Total Cost ({jobs.length} file{jobs.length !== 1 ? 's' : ''})</span>
            <span className="font-bold text-2xl">₹{totalPrice}</span>
          </div>
        </div>

        {/* Next steps */}
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
              <p className="font-semibold">2. Enter Each Code</p>
              <p className="text-sm text-muted-foreground">Enter each code one by one to print your documents.</p>
            </div>
          </div>
        </div>

        <div className="mt-12 text-center w-full">
          <Link href="/print">
            <Button variant="ghost" className="w-full">Print More Documents</Button>
          </Link>
        </div>
      </div>
    </Layout>
  );
}
