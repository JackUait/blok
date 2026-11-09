import {
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Lightbulb,
  List,
  RotateCcw,
  Square,
  createElement,
} from 'lucide';

export type ChatIcon = 'send' | 'stop' | 'copy' | 'retry' | 'chevron' | 'check' | 'summary' | 'insight' | 'question' | 'arrow';

const icons = {
  send: ArrowUp,
  stop: Square,
  copy: Copy,
  retry: RotateCcw,
  chevron: ChevronDown,
  check: Check,
  summary: List,
  insight: Lightbulb,
  question: CircleHelp,
  arrow: ArrowUpRight,
};

export const chatIcon = (name: ChatIcon, size = 18): SVGSVGElement => createElement(icons[name], {
  width: String(size),
  height: String(size),
  'stroke-width': '1.8',
  'aria-hidden': 'true',
  focusable: 'false',
}) as SVGSVGElement;
