// Logo is served from /logo.jpg in public/

export function Header() {
  return (
    <header className="w-full py-3 px-6 flex items-center justify-between z-50">
      <div className="flex items-center gap-3">
        <img src="/logo.jpg" alt="SmartPrint" className="w-10 h-10 rounded-xl shadow-md shadow-primary/30 object-cover" />
        <div className="flex flex-col">
          <h1 className="text-xl font-display font-bold leading-none tracking-tight">SMART PRINT</h1>
          <p className="text-muted-foreground font-medium text-xs uppercase tracking-widest">Self-Service Kiosk</p>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-secondary px-4 py-2 rounded-full">
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <span className="font-bold text-sm text-foreground tracking-wide">SYSTEM ONLINE</span>
      </div>
    </header>
  );
}
