import * as Dialog from '@radix-ui/react-dialog';
import * as Switch from '@radix-ui/react-switch';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

const buttonStyles = cva(
  'inline-flex items-center justify-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-mint-400 text-ink-950 hover:bg-mint-300',
        quiet: 'bg-white/5 text-white hover:bg-white/10',
        ghost: 'text-mist hover:bg-white/5 hover:text-white',
        danger: 'bg-rose-500/15 text-rose-200 hover:bg-rose-500/25',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-10',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles>
>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonStyles({ variant, size }), className)} {...props} />
));
Button.displayName = 'Button';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-xl border border-line bg-ink-950/70 px-3 text-sm text-white outline-none placeholder:text-mist/70 focus:border-mint-400/70',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'min-h-24 w-full rounded-xl border border-line bg-ink-950/70 px-3 py-2 text-sm text-white outline-none placeholder:text-mist/70 focus:border-mint-400/70',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <label
      className={cn(
        'mb-1.5 block text-[12px] font-medium uppercase tracking-[0.14em] text-mist',
        className,
      )}
    >
      {children}
    </label>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'info';
}) {
  const tones = {
    neutral: 'bg-white/5 text-mist',
    good: 'bg-mint-400/15 text-mint-200',
    bad: 'bg-rose-500/15 text-rose-200',
    warn: 'bg-amber-400/15 text-amber-200',
    info: 'bg-sky-400/15 text-sky-200',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Toggle({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-white">
      <span>{label}</span>
      <Switch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="relative h-6 w-10 rounded-full bg-white/10 data-[state=checked]:bg-mint-400"
      >
        <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-[18px]" />
      </Switch.Root>
    </label>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[86vh] w-[min(560px,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-3xl border border-line bg-ink-850 p-6 shadow-panel">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-medium text-white">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-mist">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              className="rounded-full p-1 text-mist hover:bg-white/5 hover:text-white"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
