import { useState, useEffect } from "react";
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
import { User, Mail, IdCard } from "lucide-react";

export default function TeacherProfile() {
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [empId, setEmpId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // Redirect if not logged in
    const storedName = localStorage.getItem("teacherName");
    const storedEmail = localStorage.getItem("teacherEmail");
    const storedEmpId = localStorage.getItem("teacherId");

    if (!storedName || !storedEmail || !storedEmpId) {
      setLocation("/teacher-login");
      return;
    }

    setName(storedName);
    setEmail(storedEmail);
    setEmpId(storedEmpId);
  }, [setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/teacher/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to update profile");
      }

      const data = await res.json();

      // Update local storage so the layout reflects the change
      localStorage.setItem("teacherName", data.name);
      
      // Dispatch custom event to trigger Layout update if necessary
      window.dispatchEvent(new Event("storage"));

      toast({
        title: "Profile Updated",
        description: `Your name has been updated to ${data.name}.`,
      });
    } catch (err: any) {
      toast({
        title: "Update Failed",
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

        {/* Profile Card */}
        <Card className="border-zinc-200 bg-white shadow-soft">
          <CardHeader className="text-center space-y-2 pb-2">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.25 }}
            >
              <CardTitle className="text-2xl font-bold text-zinc-950 tracking-tight">
                Teacher Profile
              </CardTitle>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.35 }}
            >
              <CardDescription className="text-zinc-500 text-sm">
                View your details and update your display name
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
              {/* Employee ID (Read-only) */}
              <div className="space-y-2">
                <Label
                  htmlFor="empId"
                  className="text-zinc-700 text-sm font-medium flex items-center gap-2"
                >
                  <IdCard className="w-4 h-4 text-zinc-400" />
                  Employee ID
                </Label>
                <Input
                  id="empId"
                  type="text"
                  value={empId}
                  disabled
                  className="bg-zinc-100 border-zinc-200 text-zinc-500 h-11 cursor-not-allowed"
                />
              </div>

              {/* Email (Read-only) */}
              <div className="space-y-2">
                <Label
                  htmlFor="email"
                  className="text-zinc-700 text-sm font-medium flex items-center gap-2"
                >
                  <Mail className="w-4 h-4 text-zinc-400" />
                  Email Address
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  disabled
                  className="bg-zinc-100 border-zinc-200 text-zinc-500 h-11 cursor-not-allowed"
                />
              </div>

              {/* Display Name */}
              <div className="space-y-2">
                <Label
                  htmlFor="name"
                  className="text-zinc-700 text-sm font-medium flex items-center gap-2"
                >
                  <User className="w-4 h-4 text-primary" />
                  Display Name
                </Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Enter your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-white border-zinc-200 text-zinc-950 placeholder:text-zinc-400 focus:border-primary focus:ring-primary/20 h-11 transition-colors"
                />
              </div>

              {/* Update Button */}
              <button
                type="submit"
                disabled={isLoading || !name.trim()}
                className="w-full h-11 rounded-md bg-primary text-black font-semibold text-sm tracking-wide hover:bg-primary/90 active:bg-primary/80 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-white flex items-center justify-center gap-2 mt-4"
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
                    <span>Saving…</span>
                  </>
                ) : (
                  "Save Changes"
                )}
              </button>
            </motion.form>
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
