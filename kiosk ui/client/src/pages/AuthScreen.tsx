import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { Keypad } from "@/components/Keypad";
import { PageTransition } from "@/components/PageTransition";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";

export function AuthScreen() {
    const [, setLocation] = useLocation();
    const [, params] = useRoute("/auth/:printId");
    const expectedPrintId = params?.printId || "";

    const [pin, setPin] = useState("");
    const [error, setError] = useState(false);

    const handleKeyPress = (key: string) => {
        setError(false);
        if (pin.length < 6) {
            setPin(prev => prev + key);
        }
    };

    const handleDelete = () => {
        setError(false);
        setPin(prev => prev.slice(0, -1));
    };

    const handleClear = () => {
        setError(false);
        setPin("");
    };

    // Auto submit when 6 digits are entered
    useEffect(() => {
        if (pin.length === 6) {
            if (pin === expectedPrintId) {
                const timer = setTimeout(() => {
                    setLocation(`/job/${pin}`);
                }, 400);
                return () => clearTimeout(timer);
            } else {
                setError(true);
                setTimeout(() => setPin(""), 500);
            }
        }
    }, [pin, expectedPrintId, setLocation]);

    return (
        <PageTransition className="items-center justify-center p-4 relative">
            <button
                onClick={() => setLocation("/")}
                className="absolute top-3 left-4 p-2 rounded-full bg-secondary hover:bg-gray-200 transition-colors z-10"
            >
                <ArrowLeft className="w-4 h-4" />
            </button>

            {/* Landscape layout: left side = title + pin, right side = keypad */}
            <div className="flex items-center gap-12 w-full max-w-5xl mx-auto">
                {/* Left panel: Title + Pin display */}
                <div className="flex-1 flex flex-col items-center justify-center">
                    <h2 className="text-4xl font-display font-bold mb-3">
                        Enter Your Print ID
                    </h2>
                    <p className="text-base text-muted-foreground mb-8">
                        Enter the 6-digit code from your receipt.
                    </p>

                    <div className="flex justify-center gap-4">
                        {[0, 1, 2, 3, 4, 5].map((index) => (
                            <div
                                key={index}
                                className={`
                                    w-16 h-20 rounded-xl flex items-center justify-center
                                    text-4xl font-display font-bold transition-all duration-300
                                    ${error ? 'bg-red-100 text-red-500 border-red-500' : ''}
                                    ${pin[index] && !error ? 'bg-primary text-black scale-105 shadow-md shadow-primary/30' : ''}
                                    ${!pin[index] && !error ? 'bg-secondary text-transparent border-2 border-gray-200' : ''}
                                `}
                            >
                                {pin[index] ? (
                                    <motion.span
                                        initial={{ opacity: 0, scale: 0.5 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                                    >
                                        {pin[index]}
                                    </motion.span>
                                ) : ''}
                            </div>
                        ))}
                    </div>

                    {error && (
                        <p className="text-red-500 text-base font-semibold mt-6">Invalid code. Try again.</p>
                    )}
                </div>

                {/* Right panel: Keypad */}
                <div className="flex-1">
                    <Keypad
                        onKeyPress={handleKeyPress}
                        onDelete={handleDelete}
                        onClear={handleClear}
                        disabled={pin.length >= 6}
                    />
                </div>
            </div>
        </PageTransition>
    );
}
