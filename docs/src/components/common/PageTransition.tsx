import { motion } from "framer-motion";
import type { ReactNode } from "react";
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

export const PageTransition = ({ children }: PageTransitionProps) => {
  return (
    <motion.div
      initial="initial"
      animate="animate"
      exit="exit"
      variants={pageVariants}
      transition={pageTransition}
    >
      {children}
    </motion.div>
  );
};
