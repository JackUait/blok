export interface NavLink {
  href: string;
  label: string;
  external?: boolean;
  active?: boolean;
}

export interface NavProps {
  currentPath: string;
  links: NavLink[];
}
