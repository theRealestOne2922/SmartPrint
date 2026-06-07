import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Keypad } from "@/components/Keypad";
import { PageTransition } from "@/components/PageTransition";
import { motion } from "framer-motion";

import { supabase } from "@/lib/supabase";

export function IdleScreen() {
  const [, setLocation] = useLocation();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const handleKeyPress = (key: string) => {
    setError("");
    if (pin.length < 6) {
      setPin(prev => prev + key);
    }
  };

  const handleDelete = () => {
    setError("");
    setPin(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    setError("");
    setPin("");
  };

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (pin.length === 6) {
      setChecking(true);
      // Look up the job in Supabase
      const lookupJob = async () => {
        const { data, error: fetchError } = await supabase
          .from('print_jobs')
          .select('*')
          .eq('job_id', pin);

        if (fetchError || !data || data.length === 0) {
          setError("No print job found for this code.");
          setChecking(false);
          setTimeout(() => setPin(""), 600);
          return;
        }

        // Just check the status of the first file in the batch
        const firstJob = data[0];
        if (firstJob.status !== 'payment_confirmed' && firstJob.status !== 'uploaded') {
          if (firstJob.status === 'completed') {
            setError("This job has already been printed.");
          } else if (firstJob.status === 'printing') {
            setError("This job is currently printing.");
          } else {
            setError("Payment not yet confirmed.");
          }
          setChecking(false);
          setTimeout(() => setPin(""), 600);
          return;
        }

        // Valid job → route to confirmation screen
        setTimeout(() => {
          setLocation(`/confirm/${pin}`);
        }, 300);
      };

      lookupJob();
    }
  }, [pin, setLocation]);

  return (
    <PageTransition className="items-center justify-center p-4 relative">
      {/* Landscape layout: left = title + pin, right = keypad */}
      <div className="flex items-center gap-10 w-full max-w-4xl mx-auto">
        {/* Left panel */}
        <div className="flex-1 flex flex-col items-center justify-center">
          <img src="/logo.jpg" alt="SmartPrint" className="w-20 h-20 rounded-full mb-6 object-cover shadow-md" />
          <h2 className="text-5xl font-display font-bold mb-2 text-center">
            Enter Your Print Code
          </h2>
          <p className="text-xl text-muted-foreground mb-8 text-center">
            Type the 6-digit code from your receipt
          </p>

          {/* PIN display — large and visible */}
          <div className="flex justify-center gap-4 mb-4">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <div
                key={index}
                className={`
                  w-16 h-20 rounded-2xl flex items-center justify-center
                  text-4xl font-display font-bold transition-all duration-300
                  ${error ? 'bg-red-100 text-red-500 border-2 border-red-400' : ''}
                  ${pin[index] && !error ? 'bg-primary text-black scale-105 shadow-lg shadow-primary/30' : ''}
                  ${!pin[index] && !error ? 'bg-secondary text-transparent border-2 border-gray-200' : ''}
                `}
              >
                {pin[index] ? (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  >
                    {pin[index]}
                  </motion.span>
                ) : ''}
              </div>
            ))}
          </div>

          {/* Error / checking state */}
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-red-500 text-sm font-semibold"
            >
              {error}
            </motion.p>
          )}
          {checking && !error && (
            <p className="text-primary text-sm font-semibold animate-pulse">
              Looking up your job...
            </p>
          )}
        </div>

        {/* Right panel: Keypad */}
        <div className="flex-1 flex justify-center">
          <Keypad
            onKeyPress={handleKeyPress}
            onDelete={handleDelete}
            onClear={handleClear}
            disabled={pin.length >= 6}
          />
        </div>
      </div>
    </PageTransition>
  );
}
