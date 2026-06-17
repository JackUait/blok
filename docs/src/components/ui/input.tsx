import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground flex h-11 w-full min-w-0 rounded-xl border border-input bg-background px-4 py-2 text-base transition-colors outline-none file:inline-flex file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:opacity-50 focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/40 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
