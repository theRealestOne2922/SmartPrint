import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { PageTransition } from "@/components/PageTransition";
import { motion } from "framer-motion";
import { Check, ShieldCheck } from "lucide-react";

const farewellMessages = [
  { text: "Have a great day!", emoji: "😊" },
  { text: "Knowledge is power!", emoji: "📚" },
  { text: "Happy printing!", emoji: "🖨️" },
  { text: "Go ace that assignment!", emoji: "🎯" },
  { text: "You're doing great!", emoji: "⭐" },
  { text: "Make today count!", emoji: "💪" },
  { text: "Stay curious, stay awesome!", emoji: "🚀" },
  { text: "Wishing you the best!", emoji: "🌟" },
];

export function SuccessScreen() {
  const [, setLocation] = useLocation();
  const [message] = useState(() => 
    farewellMessages[Math.floor(Math.random() * farewellMessages.length)]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setLocation("/");
    }, 5000);
    return () => clearTimeout(timer);
  }, [setLocation]);

  return (
    <PageTransition className="items-center justify-center p-6 bg-primary text-black">
      <div className="max-w-2xl w-full text-center flex flex-col items-center">
        
        <motion.div 
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
          className="w-24 h-24 bg-black rounded-full flex items-center justify-center mb-6 shadow-2xl shadow-black/20"
        >
          <Check className="w-12 h-12 text-primary" strokeWidth={4} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <h2 className="text-4xl font-display font-bold mb-2">
            Print Complete!
          </h2>
          <p className="text-xl font-medium mb-2 opacity-90">
            Please collect your documents from the tray.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="mt-2 mb-2 flex items-center gap-2 bg-black/10 px-5 py-3 rounded-2xl"
        >
          <ShieldCheck className="w-6 h-6 text-black opacity-80" />
          <p className="text-base font-semibold opacity-90">
            For your privacy, your file has been permanently deleted from our servers.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.6, type: "spring", stiffness: 150 }}
          className="mt-4 mb-6"
        >
          <p className="text-5xl mb-2">{message.emoji}</p>
          <p className="text-2xl font-display font-bold opacity-90">
            {message.text}
          </p>
        </motion.div>

        <div className="w-full max-w-xs h-1.5 bg-black/10 rounded-full overflow-hidden">
          <motion.div 
            className="h-full bg-black"
            initial={{ width: "100%" }}
            animate={{ width: "0%" }}
            transition={{ duration: 5, ease: "linear" }}
          />
        </div>
        <p className="text-xs font-bold mt-3 opacity-50 uppercase tracking-widest">
          Returning to home screen
        </p>

      </div>
    </PageTransition>
  );
}
