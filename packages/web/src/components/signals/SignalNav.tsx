import Link from 'next/link';

export type SignalNavItem = 'chat' | 'signals' | 'sources';

interface SignalNavProps {
  readonly active: SignalNavItem;
}

interface ItemConfig {
  readonly id: SignalNavItem;
  readonly href: string;
  readonly label: string;
}

const items: readonly ItemConfig[] = [
  { id: 'chat', href: '/', label: 'Chat' },
  { id: 'signals', href: '/signals', label: 'Signals' },
  { id: 'sources', href: '/signals/sources', label: 'Sources' },
];

export function SignalNav({ active }: SignalNavProps) {
  return (
    <nav aria-label="Signal navigation" className="flex items-center gap-2">
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={[
              'inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
              isActive
                ? 'border-owner-primary bg-owner-light text-owner-dark'
                : 'border-gray-200 bg-white text-gray-600 hover:border-owner-light hover:text-owner-dark',
            ].join(' ')}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
