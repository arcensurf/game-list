import type { ExtraContent } from '../types/game';

export default function ExtrasList({ extras }: { extras: ExtraContent[] }) {
  return (
    <div className="extras-list">
      {extras.map((group) => (
        <div key={group.label} className="extras-group">
          <h4 className="extras-group-label">{group.label}</h4>
          <ul>
            {group.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
