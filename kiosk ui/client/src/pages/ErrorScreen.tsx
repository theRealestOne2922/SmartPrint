import { useEffect } from "react";
import { useLocation } from "wouter";
import { PageTransition } from "@/components/PageTransition";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";

export function ErrorScreen() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    // Auto reset back to Idle Screen after 7 seconds
    const timer = setTimeout(() => {
      setLocation("/");
    }, 7000);
    return () => clearTimeout(timer);
  }, [setLocation]);

  return (
    <PageTransition className="items-center justify-center p-12 bg-red-600 text-white">
      <div className="max-w-4xl w-full text-center flex flex-col items-center">
        
        <motion.div 
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
          className="w-40 h-40 bg-white rounded-full flex items-center justify-center mb-12 shadow-2xl"
        >
          <AlertTriangle className="w-20 h-20 text-red-600" strokeWidth={3} />
        </motion.div>

        <h2 className="text-7xl font-display font-bold mb-8">
          Printing Failed
        </h2>
        <p className="text-3xl font-medium mb-16 opacity-90 max-w-2xl">
          An error occurred with the printer hardware. Any deducted payment will be refunded to your account automatically within 24 hours.
        </p>

        <div className="w-full max-w-lg h-2 bg-black/20 rounded-full overflow-hidden">
          <motion.div 
            className="h-full bg-white"
            initial={{ width: "100%" }}
            animate={{ width: "0%" }}
            transition={{ duration: 7, ease: "linear" }}
          />
        </div>
        <p className="text-lg font-bold mt-6 opacity-80 uppercase tracking-widest text-white">
          Resetting Kiosk
        </p>

      </div>
    </PageTransition>
  );
}
