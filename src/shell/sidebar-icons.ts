import {
  House, MessageCircle, CalendarDays, BookOpen, Users, LibraryBig, Files,
  Folder, Star, Heart, BriefcaseBusiness, CodeXml, Terminal, Globe,
  Lightbulb, Rocket, Sparkles, SquareCheck, Bookmark, Layers, LayoutGrid,
  Music, Coffee, Palette, SquarePen, MessageCirclePlus, FilePlus2, createElement,
} from 'lucide';
import type {SidebarIcon} from './sidebar-layout';

// Explicit imports keep the rest of the Lucide catalogue out of the bundle.
const icons = {
  home:House, message:MessageCircle, calendar:CalendarDays, book:BookOpen, people:Users,
  library:LibraryBig, files:Files, folder:Folder, star:Star, heart:Heart, briefcase:BriefcaseBusiness,
  code:CodeXml, terminal:Terminal, globe:Globe, lightbulb:Lightbulb, rocket:Rocket,
  sparkles:Sparkles, 'check-square':SquareCheck, bookmark:Bookmark, layers:Layers,
  'layout-grid':LayoutGrid, music:Music, coffee:Coffee, palette:Palette,
  'new-page':SquarePen, 'new-note':FilePlus2, assistant:MessageCirclePlus,
};
export function sidebarIcon(name: SidebarIcon | 'new-page' | 'new-note' | 'assistant', size = 20): SVGSVGElement {
  return createElement(icons[name], {
    width:String(size), height:String(size), 'stroke-width':'1.8',
    'aria-hidden':'true', focusable:'false',
  }) as SVGSVGElement;
}
