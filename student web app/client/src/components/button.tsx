import { ButtonHTMLAttributes, forwardRef } from "react";
import { Loader2 } from "lucide-react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg" | "icon";
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "primary", size = "md", isLoading, children, disabled, ...props }, ref) => {
    const baseStyles = "inline-flex items-center justify-center font-semibold transition-all duration-200 outline-none active-press disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";
    
    const variants = {
      primary: "bg-primary text-primary-foreground shadow-md hover:shadow-glow hover:-translate-y-0.5",
      secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      outline: "border-2 border-border bg-transparent hover:border-primary hover:text-foreground",
      ghost: "bg-transparent hover:bg-black/5 text-foreground",
    };

    const sizes = {
      sm: "h-9 px-4 text-sm rounded-xl",
      md: "h-12 px-6 text-base rounded-2xl",
      lg: "h-14 px-8 text-lg rounded-2xl",
      icon: "h-12 w-12 rounded-2xl",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {isLoading && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
