import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Eye, EyeOff, X, ShieldAlert, Loader2 } from "lucide-react";
import { Button } from "./button";

interface PasswordModalProps {
  isOpen: boolean;
  fileName: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
  isLoading: boolean;
  error: string | null;
}

export function PasswordModal({
  isOpen,
  fileName,
  onSubmit,
  onCancel,
  isLoading,
  error,
}: PasswordModalProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setPassword("");
      setShowPassword(false);
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.trim()) {
      onSubmit(password);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={!isLoading ? onCancel : undefined}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ duration: 0.3, type: "spring", damping: 25, stiffness: 300 }}
            className="relative bg-card border border-border rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            {/* Close button */}
            {!isLoading && (
              <button
                onClick={onCancel}
                className="absolute top-4 right-4 p-2 rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors z-10"
              >
                <X className="w-5 h-5" />
              </button>
            )}

            <form onSubmit={handleSubmit} className="p-8">
              {/* Lock Icon */}
              <div className="flex justify-center mb-6">
                <motion.div
                  initial={{ rotate: -10 }}
                  animate={{ rotate: [0, -5, 5, -5, 0] }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  className="w-20 h-20 bg-amber-50 border-2 border-amber-200 rounded-full flex items-center justify-center"
                >
                  <ShieldAlert className="w-10 h-10 text-amber-500" />
                </motion.div>
              </div>

              {/* Title */}
              <h3 className="text-2xl font-bold text-center mb-2 font-display">
                Password Protected
              </h3>
              <p className="text-muted-foreground text-center text-sm mb-2">
                This file is encrypted and requires a password to proceed.
              </p>

              {/* File name badge */}
              <div className="flex justify-center mb-6">
                <div className="inline-flex items-center gap-2 bg-secondary px-4 py-2 rounded-xl">
                  <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium truncate max-w-[250px]">{fileName}</span>
                </div>
              </div>

              {/* Password Input */}
              <div className="relative mb-4">
                <input
                  ref={inputRef}
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter file password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  className={`w-full px-4 py-4 pr-12 rounded-2xl border-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-all ${
                    error
                      ? "border-destructive focus:ring-destructive"
                      : "border-border focus:border-primary"
                  } ${isLoading ? "opacity-50" : ""}`}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isLoading}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>

              {/* Error Message */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-4"
                  >
                    <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 px-4 py-3 rounded-xl">
                      <Lock className="w-4 h-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Buttons */}
              <div className="flex flex-col gap-3">
                <Button
                  type="submit"
                  disabled={!password.trim() || isLoading}
                  isLoading={isLoading}
                  className="w-full"
                  size="lg"
                >
                  {isLoading ? "Decrypting..." : "Unlock & Continue"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onCancel}
                  disabled={isLoading}
                  className="w-full"
                  size="md"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
