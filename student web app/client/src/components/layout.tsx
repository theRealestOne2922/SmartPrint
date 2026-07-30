import { ReactNode, useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { LogIn, GraduationCap, Shield, User, LogOut } from "lucide-react";

export function Layout({ children }: { children: ReactNode }) {
  const [showMenu, setShowMenu] = useState(false);
  const [loggedInUser, setLoggedInUser] = useState<string | null>(null);
  const [location, setLocation] = useLocation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const adminAuth = localStorage.getItem("adminAuth");
    const teacherName = localStorage.getItem("teacherName");
    if (adminAuth === "true") {
      setLoggedInUser("Admin");
    } else if (teacherName) {
      setLoggedInUser(teacherName);
    } else {
      setLoggedInUser(null);
    }
  }, [location]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      {/* Abstract Background Elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-primary/10 rounded-full blur-[80px] pointer-events-none" />

      <header className="w-full px-6 py-4 flex items-center justify-between z-30 relative">
        <Link 
          href="/" 
          className="flex items-center gap-2 group outline-none"
        >
          <img src="/logo.jpg" alt="SmartPrint" className="w-10 h-10 rounded-xl shadow-sm group-hover:scale-105 transition-transform duration-300 object-cover" />
          <span className="font-display font-bold text-xl tracking-tight">
            Smart<span className="text-primary-foreground/50">Print</span>
          </span>
        </Link>

        {/* Login / User Menu Button */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm hover:shadow-glow hover:-translate-y-0.5 transition-all duration-200 active:scale-95"
          >
            {loggedInUser ? (
              <>
                <User className="w-4 h-4" />
                {loggedInUser}
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                Login
              </>
            )}
          </button>

          {showMenu && (
            <div className="absolute right-0 mt-2 w-56 bg-card rounded-2xl shadow-lg border border-border/50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 z-50">
              {loggedInUser ? (
                <>
                  {loggedInUser !== "Admin" && (
                    <button
                      onPointerDown={(e) => {
                        e.preventDefault();
                        setLocation("/teacher-profile");
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-primary/10 hover:text-primary transition-colors text-sm font-medium outline-none group"
                    >
                      <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary group-hover:bg-primary/20 flex items-center justify-center transition-colors">
                        <User className="w-5 h-5" />
                      </div>
                      <div className="flex flex-col text-left">
                        <div className="font-semibold text-foreground group-hover:text-primary">Profile</div>
                        <div className="text-xs text-muted-foreground group-hover:text-primary/70">View details</div>
                      </div>
                    </button>
                  )}
                  {loggedInUser !== "Admin" && <div className="h-px bg-border/50" />}
                  <button
                    onPointerDown={(e) => {
                      e.preventDefault();
                      localStorage.removeItem("adminAuth");
                      localStorage.removeItem("adminToken");
                      localStorage.removeItem("teacherId");
                      localStorage.removeItem("teacherName");
                      localStorage.removeItem("teacherToken");
                      setLoggedInUser(null);
                      setShowMenu(false);
                      setLocation("/");
                    }}
                    className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-destructive/10 hover:text-destructive transition-colors text-sm font-medium outline-none group"
                  >
                    <div className="w-9 h-9 rounded-xl bg-destructive/10 text-destructive group-hover:bg-destructive/20 flex items-center justify-center transition-colors">
                      <LogOut className="w-5 h-5" />
                    </div>
                    <div className="flex flex-col text-left">
                      <div className="font-semibold text-foreground group-hover:text-destructive">Log Out</div>
                      <div className="text-xs text-muted-foreground group-hover:text-destructive/70">End session</div>
                    </div>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setLocation("/teacher-login");
                      setShowMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-primary hover:text-black transition-colors text-sm font-medium outline-none group"
                  >
                    <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary group-hover:bg-black/10 group-hover:text-black flex items-center justify-center transition-colors">
                      <GraduationCap className="w-5 h-5" />
                    </div>
                    <div className="flex flex-col text-left">
                      <div className="font-semibold text-foreground group-hover:text-black">Teacher Portal</div>
                      <div className="text-xs text-muted-foreground group-hover:text-black/70">Login via VTOP</div>
                    </div>
                  </button>
                  <div className="h-px bg-border/50" />
                  <button
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setLocation("/admin-login");
                      setShowMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-primary hover:text-black transition-colors text-sm font-medium outline-none group"
                  >
                    <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary group-hover:bg-black/10 group-hover:text-black flex items-center justify-center transition-colors">
                      <Shield className="w-5 h-5" />
                    </div>
                    <div className="flex flex-col text-left">
                      <div className="font-semibold text-foreground group-hover:text-black">Admin Portal</div>
                      <div className="text-xs text-muted-foreground group-hover:text-black/70">Secure access</div>
                    </div>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col relative">
        {children}
      </main>
      
      <footer className="py-6 text-center text-muted-foreground text-sm z-10">
        <p>&copy; {new Date().getFullYear()} SmartPrint Kiosk. Fast & Easy.</p>
      </footer>
    </div>
  );
}
