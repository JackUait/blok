import {
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  History,
  Lightbulb,
  List,
  PanelRight,
  Plus,
  RotateCcw,
  Settings2,
  Square,
  X,
  createElement,
} from 'lucide';

export type ChatIcon = 'send' | 'stop' | 'copy' | 'retry' | 'chevron' | 'check' | 'summary' | 'insight' | 'question' | 'arrow' | 'history' | 'plus' | 'panel' | 'settings' | 'close';

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
  history: History,
  plus: Plus,
  panel: PanelRight,
  settings: Settings2,
  close: X,
};

export const chatIcon = (name: ChatIcon, size = 18): SVGSVGElement => createElement(icons[name], {
  width: String(size),
  height: String(size),
  'stroke-width': '1.8',
  'aria-hidden': 'true',
  focusable: 'false',
}) as SVGSVGElement;
