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
import { API_BASE } from "@/lib/api-config";

export default function TeacherRegister() {
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [empId, setEmpId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  // Set once registration succeeds: the address exists but is unconfirmed, so
  // the page asks for the code instead of sending them to a login that refuses.
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [code, setCode] = useState("");
  const { toast } = useToast();

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/teacher/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "That code is not valid.");
      toast({ title: "Address confirmed", description: data.message || "You can sign in now." });
      setLocation("/teacher-login");
    } catch (err: any) {
      toast({ title: "Could not confirm", description: err.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const resendCode = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/teacher/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      toast({ title: "Sent", description: data.message || "A new code is on its way." });
    } catch {
      toast({ title: "Error", description: "Could not reach the server.", variant: "destructive" });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/teacher/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, empId }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Registration failed");
      }

      // Show what the server actually said. This used to claim the account was
      // created and ready to sign in, which is wrong on both counts now: new
      // accounts wait for an administrator, and a duplicate creates nothing at
      // all. A teacher told "you can now log in" and then refused would read it
      // as the system being broken.
      toast({
        title: "Check your email",
        description: data.message || "Enter the 6-digit code we sent to confirm this address.",
      });
      // Stay on the page and ask for the code, rather than bouncing to a login
      // that will refuse them — the address is not confirmed yet.
      setAwaitingCode(true);
    } catch (err: any) {
      toast({
        title: "Registration Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden">
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

        {/* Register Card */}
        <Card className="border-zinc-200 bg-white shadow-soft">
          <CardHeader className="text-center space-y-2 pb-2">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.25 }}
            >
              <CardTitle className="text-2xl font-bold text-zinc-950 tracking-tight">
                Create Teacher Account
              </CardTitle>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.35 }}
            >
              <CardDescription className="text-zinc-500 text-sm">
                Register to manage your print jobs
              </CardDescription>
            </motion.div>
          </CardHeader>

          <CardContent className="pt-4">
            {awaitingCode ? (
              <form onSubmit={submitCode} className="space-y-4">
                <p className="text-sm text-zinc-600 leading-relaxed">
                  A 6-digit code is on its way to{" "}
                  <span className="font-medium text-zinc-900">{email}</span>. Enter it
                  below to confirm the address is yours.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="code" className="text-zinc-700 text-sm font-medium">
                    Verification code
                  </Label>
                  <Input
                    id="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    placeholder="6-digit code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    className="bg-white border-zinc-200 text-zinc-950 tracking-[0.4em] text-center text-lg h-11"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading || code.length !== 6}
                  className="w-full py-2.5 px-4 rounded-lg font-semibold text-sm bg-primary text-black hover:bg-primary/95 transition-colors disabled:opacity-50"
                >
                  {isLoading ? "Confirming…" : "Confirm address"}
                </button>
                <div className="flex items-center justify-between text-xs">
                  <button type="button" onClick={resendCode} className="text-primary hover:underline font-medium">
                    Resend code
                  </button>
                  <span className="text-zinc-400">Expires in 15 minutes</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Confirming proves the address is yours — your account is ready to
                  sign in as soon as this succeeds.
                </p>
              </form>
            ) : (
            <motion.form
              onSubmit={handleSubmit}
              className="space-y-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.45 }}
            >
              {/* Name */}
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-zinc-700 text-sm font-medium">
                  Full Name
                </Label>
                <Input
                  id="name"
                  type="text"
                  required
                  placeholder="Enter your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-white border-zinc-200 text-zinc-950 placeholder:text-zinc-400 focus:border-primary focus:ring-primary/20 h-11 transition-colors"
                />
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-zinc-700 text-sm font-medium">
                  Email Address (for OTP)
                </Label>
                <Input
                  id="email"
                  type="email"
                  required
                  placeholder="e.g. faculty@vit.ac.in"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-white border-zinc-200 text-zinc-950 placeholder:text-zinc-400 focus:border-primary focus:ring-primary/20 h-11 transition-colors"
                />
                {/* Said up front. The server enforces it regardless, but being
                    told only after filling the whole form in reads as the page
                    being broken. */}
                <p className="text-xs text-zinc-500">
                  Must be your institute address ending in <span className="font-medium">@vit.ac.in</span>.
                </p>
              </div>

              {/* Emp ID */}
              <div className="space-y-1.5">
                <Label htmlFor="empId" className="text-zinc-700 text-sm font-medium">
                  Employee ID / Faculty ID
                </Label>
                <Input
                  id="empId"
                  type="text"
                  required
                  placeholder="e.g. VIT12345"
                  value={empId}
                  onChange={(e) => setEmpId(e.target.value)}
                  className="bg-white border-zinc-200 text-zinc-950 placeholder:text-zinc-400 focus:border-primary focus:ring-primary/20 h-11 transition-colors"
                />
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-zinc-700 text-sm font-medium">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={10}
                  placeholder="Create a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-white border-zinc-200 text-zinc-950 placeholder:text-zinc-400 focus:border-primary focus:ring-primary/20 h-11 transition-colors"
                />
                {/* Say the rule up front. The server enforces it either way, but
                    being told after submitting reads as the form being broken. */}
                <p className="text-xs text-zinc-500">
                  At least 10 characters. A short phrase you'll remember beats a
                  short password with symbols in it.
                </p>
              </div>

              {/* Register Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 mt-2 rounded-md bg-primary text-black font-semibold text-sm tracking-wide hover:bg-primary/90 active:bg-primary/80 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-white flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <svg
                      className="animate-spin h-4 w-4 text-black"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>Creating Account…</span>
                  </>
                ) : (
                  "Create Account"
                )}
              </button>
            </motion.form>
            )}

            <div className="mt-6 text-center text-sm">
              <span className="text-zinc-500">Already have an account? </span>
              <a href="/teacher-login" className="text-primary font-semibold hover:underline">
                Sign in
              </a>
            </div>
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
