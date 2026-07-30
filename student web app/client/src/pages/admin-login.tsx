import { useState } from "react";
import { API_BASE } from "@/lib/api-config";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export default function AdminLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim() || !password.trim()) {
      toast({
        title: "Missing fields",
        description: "Please enter both username and password.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      // Authenticate via Express API (was: direct Supabase query on admins table)
      const res = await fetch(`${API_BASE}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        if (res.status === 401) {
          toast({
            title: "Invalid credentials",
            description: "The username or password you entered is incorrect.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Login failed",
            description: err.message || "An unexpected error occurred. Please try again.",
            variant: "destructive",
          });
        }
        setLoading(false);
        return;
      }

      const { token } = await res.json();
      localStorage.setItem("adminAuth", "true");
      localStorage.setItem("adminToken", token);
      toast({
        title: "Welcome back!",
        description: "Redirecting to admin dashboard…",
      });
      setLocation("/admin-dashboard");
    } catch {
      toast({
        title: "Login failed",
        description: "Something went wrong. Please try again later.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-zinc-50 px-4">
      {/* Decorative background elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-primary/3 blur-[100px]" />
      </div>

      {/* Back to Home Button */}
      <a href="/" className="absolute top-6 left-6 text-zinc-500 hover:text-primary transition-colors flex items-center gap-2 font-medium text-sm z-50 bg-white/50 px-4 py-2 rounded-full shadow-sm backdrop-blur-sm border border-zinc-200/50">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        Back to Home
      </a>

      <motion.div
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md"
      >
        <Card className="border border-zinc-200 bg-white shadow-soft">
          <CardHeader className="items-center text-center pb-2 pt-8">
            {/* Lock icon */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.15 }}
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 ring-2 ring-primary/20"
            >
              <Lock className="h-8 w-8 text-black" />
            </motion.div>

            <CardTitle className="text-2xl font-bold tracking-tight text-zinc-950">
              Admin Portal
            </CardTitle>
            <CardDescription className="text-zinc-500 mt-1">
              Secure access for administrators only
            </CardDescription>
          </CardHeader>

          <CardContent className="px-8 pb-8 pt-4">
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Username */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25, duration: 0.4 }}
                className="space-y-2"
              >
                <Label htmlFor="username" className="text-sm font-medium text-zinc-700">
                  Username
                </Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  className="border-zinc-200 bg-white text-zinc-950 placeholder:text-zinc-400 focus-visible:ring-primary/50 focus-visible:border-primary/40"
                />
              </motion.div>

              {/* Password */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.35, duration: 0.4 }}
                className="space-y-2"
              >
                <Label htmlFor="password" className="text-sm font-medium text-zinc-700">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="border-zinc-200 bg-white text-zinc-950 placeholder:text-zinc-400 focus-visible:ring-primary/50 focus-visible:border-primary/40"
                />
              </motion.div>

              {/* Login button */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45, duration: 0.4 }}
              >
                <button
                  type="submit"
                  disabled={loading}
                  className="mt-2 w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-black shadow-md transition-all duration-200 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg
                        className="h-4 w-4 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
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
                      Signing in…
                    </span>
                  ) : (
                    "Sign In"
                  )}
                </button>
              </motion.div>
            </form>

            {/* Footer note */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.5 }}
              className="mt-6 text-center text-xs text-zinc-400 font-medium"
            >
              Protected area · Unauthorized access is prohibited
            </motion.p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
