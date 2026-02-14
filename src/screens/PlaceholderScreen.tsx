interface PlaceholderScreenProps {
  title: string;
  description: string;
}

export function PlaceholderScreen({ title, description }: PlaceholderScreenProps): JSX.Element {
  return (
    <div className="placeholder-screen">
      <div className="placeholder-card">
        <span className="placeholder-emoji">{"🚧"}</span>
        <h2>{title}</h2>
        <p>{description}</p>
        <p className="placeholder-hint">Coming soon</p>
      </div>
    </div>
  );
}
