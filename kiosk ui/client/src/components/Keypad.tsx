import { Delete, X } from "lucide-react";
import { motion } from "framer-motion";

interface KeypadProps {
  onKeyPress: (key: string) => void;
  onDelete: () => void;
  onClear: () => void;
  disabled?: boolean;
}

export function Keypad({ onKeyPress, onDelete, onClear, disabled = false }: KeypadProps) {
  const keys = [
    '1', '2', '3',
    '4', '5', '6',
    '7', '8', '9',
    'clear', '0', 'delete'
  ];

  return (
    <div className="grid grid-cols-3 gap-5 w-full max-w-[500px] mx-auto">
      {keys.map((key, i) => {
        const isAction = key === 'clear' || key === 'delete';

        return (
          <motion.button
            key={i}
            whileTap={!disabled ? { scale: 0.92 } : {}}
            onClick={() => {
              if (disabled) return;
              if (key === 'clear') onClear();
              else if (key === 'delete') onDelete();
              else onKeyPress(key);
            }}
            disabled={disabled}
            className={`
              h-[96px] rounded-[2rem] text-4xl font-display font-bold
              flex items-center justify-center
              ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
              ${isAction ? 'keypad-btn-action text-muted-foreground' : 'keypad-btn text-foreground'}
            `}
          >
            {key === 'delete' ? (
              <Delete size={36} strokeWidth={2.5} />
            ) : key === 'clear' ? (
              <X size={36} strokeWidth={2.5} />
            ) : (
              key
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
