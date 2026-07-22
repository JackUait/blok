import { motion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import type { Transition, Variants } from "framer-motion";

interface PageTransitionProps {
  children: ReactNode;
}

// Subtle, refined page transition - quick and unobtrusive
const pageVariants: Variants = {
  initial: {
    opacity: 0,
    y: 8,
  },
  animate: {
    opacity: 1,
    y: 0,
  },
  exit: {
    opacity: 0,
  },
};

const pageTransition: Transition = {
  type: "tween",
  ease: [0.25, 0.46, 0.45, 0.94],
  duration: 0.2,
};

// The first route of a session is the one baked into the prerendered HTML.
// Mounting it at opacity 0 would blank the page until hydration finishes and
// would disqualify it as an LCP candidate, so only later navigations animate in.
let hasRenderedFirstRoute = false;

export const PageTransition = ({ children }: PageTransitionProps) => {
  const [animateOnMount] = useState(() => hasRenderedFirstRoute);

  useEffect(() => {
    hasRenderedFirstRoute = true;
  }, []);

  return (
    <motion.div
      initial={animateOnMount ? "initial" : false}
      animate="animate"
      exit="exit"
      variants={pageVariants}
      transition={pageTransition}
    >
      {children}
    </motion.div>
  );
};
