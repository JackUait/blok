interface LogoProps {
  size?: number;
  showLabel?: boolean;
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({ size = 32, className = "" }) => {
  return (
    <img
      src="/mascot.png"
      alt="Blok"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: "contain" }}
      data-blok-testid="logo"
    />
  );
};
