import { useEffect } from "react";
import { useLocation } from "wouter";
import { PageTransition } from "@/components/PageTransition";
import { motion } from "framer-motion";
import { Ban } from "lucide-react";

// Shown when a job ends up cancelled rather than printed.
//
// Deliberately not the red ErrorScreen: a cancellation is someone choosing to
// stop, not the printer breaking, and telling staff something "failed" when
// they pressed stop themselves would send them looking for a fault that isn't
// there. Same shape and timing as ErrorScreen so the kiosk still resets itself
// with nobody standing over it.
export function CancelledScreen() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    const timer = setTimeout(() => {
      setLocation("/");
    }, 7000);
    return () => clearTimeout(timer);
  }, [setLocation]);

  return (
    <PageTransition className="items-center justify-center p-12 bg-gray-800 text-white">
      <div className="max-w-4xl w-full text-center flex flex-col items-center">

        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
          className="w-40 h-40 bg-white rounded-full flex items-center justify-center mb-12 shadow-2xl"
        >
          <Ban className="w-20 h-20 text-gray-800" strokeWidth={3} />
        </motion.div>

        <h2 className="text-7xl font-display font-bold mb-8">
          Print Cancelled
        </h2>
        {/* Deliberately does not promise the code can be reused: once a job is
            'cancelled' the server only allows 'printing' from 'uploaded', so it
            cannot be released again. And if paper had already started, the
            printer's own buffer may still push a few sheets out — saying
            otherwise would have staff assume a fault when those appear. */}
        <p className="text-3xl font-medium mb-16 opacity-90 max-w-2xl">
          This print was stopped. If pages had already started, a few more may
          still come out of the printer.
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
