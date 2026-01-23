interface LogoProps {
  size?: number;
  showLabel?: boolean;
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({ size = 32, className = '' }) => {
  const uniqueId = `logo-gradient-${Math.random().toString(36).slice(2, 11)}`;

  return (
    <svg className={className} width={size} height={size} viewBox="0 0 128 128" fill="none">
      <defs>
        <linearGradient id={uniqueId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#007AFF" />
          <stop offset="100%" stopColor="#5856D6" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="28" fill={`url(#${uniqueId})`} />
      <path
        d="M36 40h56c2.2 0 4 1.8 4 4v40c0 2.2-1.8 4-4 4H36c-2.2 0-4-1.8-4-4V44c0-2.2 1.8-4 4-4z"
        fill="white"
        opacity="0.9"
      />
      <rect x="42" y="52" width="44" height="4" rx="2" fill="#007AFF" />
      <rect x="42" y="62" width="32" height="4" rx="2" fill="#5856D6" />
      <rect x="42" y="72" width="38" height="4" rx="2" fill="#007AFF" />
      <circle cx="98" cy="84" r="14" fill="white" />
      <path
        d="M94 84l3 3 6-6"
        stroke="#007AFF"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
};
