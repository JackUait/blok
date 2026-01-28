import type { ReactNode } from 'react';

interface RecipeCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  tip?: string;
}

export const RecipeCard: React.FC<RecipeCardProps> = ({
  icon,
  title,
  description,
  children,
  tip,
}) => {
  return (
    <div className="recipe-card" data-blok-testid="recipe-card">
      <div className="recipe-card-header">
        <div className="recipe-card-icon" data-blok-testid="recipe-card-icon">
          {icon}
        </div>
        <div>
          <h3 className="recipe-card-title">{title}</h3>
          <p className="recipe-card-description">{description}</p>
        </div>
      </div>
      <div className="recipe-card-content" data-blok-testid="recipe-card-content">
        {children}
      </div>
      {tip && (
        <div className="recipe-card-tip" data-blok-testid="recipe-card-tip">
          <strong>Pro tip</strong> {tip}
        </div>
      )}
    </div>
  );
};
