import { Link, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/button";
import { ArrowRight, UploadCloud, IndianRupee, Printer as PrinterIcon, CheckCircle } from "lucide-react";
import { motion } from "framer-motion";

const steps = [
  {
    icon: UploadCloud,
    title: "Upload Document",
    description: "Upload any document securely from your phone or computer."
  },
  {
    icon: IndianRupee,
    title: "Pay & Get Code",
    description: "Pay via UPI and receive your 6-digit print code instantly."
  },
  {
    icon: PrinterIcon,
    title: "Go to Kiosk",
    description: "Find the nearest SmartPrint Kiosk on campus."
  },
  {
    icon: CheckCircle,
    title: "Enter Code & Print",
    description: "Enter your code at the kiosk and collect your prints."
  }
];

export default function Home() {
  const [, setLocation] = useLocation();

  const handleStartPrinting = () => {
    const adminAuth = localStorage.getItem("adminAuth");
    const teacherName = localStorage.getItem("teacherName");
    if (adminAuth || teacherName) {
      setLocation("/print");
    } else {
      setLocation("/teacher-login");
    }
  };

  return (
    <Layout>
      <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto w-full pt-12 pb-20">
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary text-sm font-semibold mb-6">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            Kiosks are online and ready
          </div>
          
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold text-balance leading-[1.1] mb-6">
            Print smarter, <br className="hidden sm:block"/> not harder.
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto text-balance">
            Skip the lines and USB drives. Upload your document right now, get your secure code, and print at any kiosk in seconds.
          </p>
          
          <button onClick={handleStartPrinting} className="outline-none text-left">
            <Button size="lg" className="w-full sm:w-auto px-10 text-lg group">
              Start Printing Now
              <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Button>
          </button>
        </motion.div>

        <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((step, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 * (i + 1) }}
              className="bg-card p-6 rounded-3xl shadow-soft border border-border/50 hover-elevate relative overflow-hidden group"
            >
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <span className="text-8xl font-display font-bold">{i + 1}</span>
              </div>
              <div className="w-12 h-12 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mb-6">
                <step.icon className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-2">{step.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {step.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
