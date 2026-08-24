import { PLATFORM_ICON } from '../utils/platformIcons';
import { getLightColor } from '../utils/platformColors';

export default function PlatformBadge({ platform }: { platform: string }) {
  const icon = PLATFORM_ICON[platform];
  const lightColor = getLightColor(platform);

  return (
    <span className={`platform-badge${icon ? '' : ' platform-badge--no-icon'}`}>
      {icon && (
        <span
          className="platform-badge-icon"
          style={{
            backgroundColor: lightColor,
            opacity: icon.solid ? 0.55 : undefined,
            maskImage: `url(${icon.url})`,
            WebkitMaskImage: `url(${icon.url})`,
          }}
        />
      )}
      <span className="platform-badge-name" style={{ color: lightColor }}>{platform}</span>
    </span>
  );
}
