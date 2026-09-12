// Renders a dive computer's manufacturer logo, resolved from its free-text model
// string. Falls back to a generic dive-computer glyph when the brand is unknown
// or we ship no asset for it (see resolveBrand).
import { resolveBrand } from '../brands/resolveBrand';

interface Props {
  computerModel: string;
  variant: 'wordmark' | 'favicon';
  className?: string;
}

function DiveComputerGlyph({ className, title }: { className?: string; title: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label={title}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="8" />
      <path d="M12 12l3-3" />
      <path d="M12 4v1.6M12 18.4V20M4 12h1.6M18.4 12H20" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BrandLogo({ computerModel, variant, className }: Props) {
  const brand = resolveBrand(computerModel);
  const src = brand && (variant === 'wordmark' ? brand.wordmark : brand.favicon);
  if (src) {
    return <img src={src} alt={brand!.name} title={brand!.name} className={className} loading="lazy" />;
  }
  return <DiveComputerGlyph className={className} title={brand?.name ?? 'Dive computer'} />;
}
