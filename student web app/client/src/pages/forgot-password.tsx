import { useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { API_BASE } from "@/lib/api-config";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

type Step = "EMAIL" | "OTP" | "NEW_PASSWORD";

export default function ForgotPassword() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>("EMAIL");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/teacher/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to request OTP");
      }
      toast({
        title: "Code Sent",
        description: "If the email exists, an OTP has been sent.",
      });
      setStep("OTP");
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/teacher/verify-reset-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Invalid OTP");
      }
      toast({
        title: "OTP Verified",
        description: "Please enter your new password.",
      });
      setStep("NEW_PASSWORD");
    } catch (err: any) {
      toast({
        title: "Verification Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords do not match",
        description: "Please ensure both passwords match.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/teacher/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp, newPassword }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to reset password");
      }
      toast({
        title: "Password Reset Successful",
        description: "You can now log in with your new password.",
      });
      setLocation("/teacher-login");
    } catch (err: any) {
      toast({
        title: "Reset Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-primary/3 blur-[100px]" />
      </div>

      <motion.div
        className="w-full max-w-md relative z-10"
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        <Card className="border-zinc-200 bg-white shadow-soft">
          <CardHeader className="text-center space-y-2 pb-2">
            <CardTitle className="text-2xl font-bold text-zinc-950 tracking-tight">
              Reset Password
            </CardTitle>
            <CardDescription className="text-zinc-500 text-sm">
              {step === "EMAIL" && "Enter your email to receive a reset code"}
              {step === "OTP" && "Enter the 6-digit code sent to your email"}
              {step === "NEW_PASSWORD" && "Create a new, secure password"}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-4 overflow-hidden relative">
            <AnimatePresence mode="wait">
              {step === "EMAIL" && (
                <motion.form
                  key="EMAIL"
                  onSubmit={handleRequestOtp}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-zinc-700 text-sm font-medium">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      required
                      placeholder="faculty@vit.ac.in"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="bg-white border-zinc-200 focus:border-primary"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full h-11 rounded-md bg-primary text-black font-semibold flex items-center justify-center disabled:opacity-50"
                  >
                    {isLoading ? "Sending..." : "Send Reset Code"}
                  </button>
                  <div className="text-center text-sm mt-4">
                    <a href="/teacher-login" className="text-zinc-500 hover:text-primary">Back to Login</a>
                  </div>
                </motion.form>
              )}

              {step === "OTP" && (
                <motion.form
                  key="OTP"
                  onSubmit={handleVerifyOtp}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="otp" className="text-zinc-700 text-sm font-medium">6-Digit Code</Label>
                    <Input
                      id="otp"
                      type="text"
                      required
                      maxLength={6}
                      placeholder="123456"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      className="bg-white border-zinc-200 focus:border-primary text-center text-xl tracking-widest font-mono"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full h-11 rounded-md bg-primary text-black font-semibold flex items-center justify-center disabled:opacity-50"
                  >
                    {isLoading ? "Verifying..." : "Verify Code"}
                  </button>
                  <div className="text-center text-sm mt-4">
                    <button type="button" onClick={() => setStep("EMAIL")} className="text-zinc-500 hover:text-primary">Change Email</button>
                  </div>
                </motion.form>
              )}

              {step === "NEW_PASSWORD" && (
                <motion.form
                  key="NEW_PASSWORD"
                  onSubmit={handleResetPassword}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="newPassword" className="text-zinc-700 text-sm font-medium">New Password</Label>
                    <Input
                      id="newPassword"
                      type="password"
                      required
                      placeholder="Enter new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="bg-white border-zinc-200 focus:border-primary"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword" className="text-zinc-700 text-sm font-medium">Confirm Password</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      required
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="bg-white border-zinc-200 focus:border-primary"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full h-11 rounded-md bg-primary text-black font-semibold flex items-center justify-center disabled:opacity-50"
                  >
                    {isLoading ? "Resetting..." : "Reset Password"}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
