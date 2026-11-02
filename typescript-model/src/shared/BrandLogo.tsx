type BrandLogoVariant = "full" | "mark";

/** Displays the matching Pyme360 logo for the currently resolved light/dark theme. */
export function BrandLogo({ variant }: { variant: BrandLogoVariant }) {
  const filePrefix = variant === "mark" ? "pyme360-mark" : "pyme360-logo";
  const baseUrl = import.meta.env.BASE_URL;

  return (
    <span className={`brand-logo brand-logo-${variant}`} role="img" aria-label="Pyme360">
      <img
        className="brand-logo-light"
        src={`${baseUrl}${filePrefix}-light.png`}
        alt=""
      />
      <img
        className="brand-logo-dark"
        src={`${baseUrl}${filePrefix}-dark.png`}
        alt=""
      />
    </span>
  );
}
