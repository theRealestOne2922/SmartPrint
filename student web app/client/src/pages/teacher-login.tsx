import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export default function TeacherLogin() {
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    // Prototype: accept any credentials
    setTimeout(() => {
      localStorage.setItem("teacherId", "1001");
      localStorage.setItem("teacherName", username || "Teacher Name");
      toast({
        title: "Logged in successfully",
        description: `Welcome back, ${username || "Teacher"}!`,
      });
      setLocation("/print");
    }, 600);
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-primary/3 blur-[100px]" />
      </div>

      {/* Top accent bar */}
      <motion.div
        className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-primary to-transparent"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      />

      <motion.div
        className="w-full max-w-md relative z-10"
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        {/* VIT Logo */}
        <motion.div
          className="flex justify-center mb-8"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
        >
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center shadow-md">
            <span className="text-black font-extrabold text-xl tracking-tight">
              VIT
            </span>
          </div>
        </motion.div>

        {/* Login Card */}
        <Card className="border-zinc-200 bg-white shadow-soft">
          <CardHeader className="text-center space-y-2 pb-2">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.25 }}
            >
              <CardTitle className="text-2xl font-bold text-zinc-950 tracking-tight">
                Teacher Portal
              </CardTitle>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.35 }}
            >
              <CardDescription className="text-zinc-500 text-sm">
                Sign in with your VIT credentials to access SmartPrint
              </CardDescription>
            </motion.div>
          </CardHeader>

          <CardContent className="pt-4">
            <motion.form
              onSubmit={handleSubmit}
              className="space-y-5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.45 }}
            >
              {/* Username / Emp ID */}
              <div className="space-y-2">
                <Label
                  htmlFor="username"
                  className="text-zinc-700 text-sm font-medium"
                >
                  Username / Emp ID
                </Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter your Employee ID"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-white border-zinc-200 text-zinc-950 placeholder:text-zinc-400 focus:border-primary focus:ring-primary/20 h-11 transition-colors"
                />
              </div>

              {/* Password */}
              <div className="space-y-2">
                <Label
                  htmlFor="password"
                  className="text-zinc-700 text-sm font-medium"
                >
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-white border-zinc-200 text-zinc-950 placeholder:text-zinc-400 focus:border-primary focus:ring-primary/20 h-11 transition-colors"
                />
              </div>

              {/* Login Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 rounded-md bg-primary text-black font-semibold text-sm tracking-wide hover:bg-primary/90 active:bg-primary/80 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-white flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <svg
                      className="animate-spin h-4 w-4 text-black"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    <span>Signing in…</span>
                  </>
                ) : (
                  "Sign In"
                )}
              </button>
            </motion.form>

            {/* Prototype badge */}
            <motion.div
              className="mt-6 pt-4 border-t border-zinc-100"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.6 }}
            >
              <p className="text-center text-xs text-zinc-500 flex items-center justify-center gap-1.5 font-medium">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/60" />
                Prototype Mode · Any credentials accepted
              </p>
            </motion.div>
          </CardContent>
        </Card>

        {/* Branding footer */}
        <motion.p
          className="text-center text-zinc-450 text-xs mt-6 font-medium"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.7 }}
        >
          SmartPrint &copy; {new Date().getFullYear()} &middot; VIT Chennai
        </motion.p>
      </motion.div>
    </div>
  );
}
