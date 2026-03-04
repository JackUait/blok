export interface NavLink {
  href: string;
  label: string;
  i18nKey?: string;
  external?: boolean;
  active?: boolean;
}

export interface NavProps {
  currentPath: string;
  links: NavLink[];
}
