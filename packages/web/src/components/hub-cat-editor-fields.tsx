'use client';

import type { HTMLAttributes, ReactNode } from 'react';

export function SectionCard({
  title,
  description,
  tone = 'neutral',
  children,
}: {
  title: string;
  description?: string;
  tone?: 'neutral' | 'success';
  children: ReactNode;
}) {
  const toneClass =
    tone === 'success'
      ? 'border-[#CFE5D5] bg-[#F2FAF4]'
      : 'border-[#F1E7DF] bg-[#FFFDFC]';
  return (
    <section className={`rounded-[20px] border p-5 ${toneClass}`}>
      <div className="space-y-1">
        <h4 className="text-[17px] font-semibold text-[#2D2118]">{title}</h4>
        {description ? <p className="text-sm leading-6 text-[#7F7168]">{description}</p> : null}
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function TextField({
  label,
  ariaLabel,
  value,
  onChange,
  inputMode,
  placeholder,
}: {
  label: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  placeholder?: string;
}) {
  return (
    <label className="space-y-1.5 text-sm text-[#5C4B42]">
      <span className="font-medium">{label}</span>
      <input
        aria-label={ariaLabel ?? label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-[#E8DCCF] bg-[#F7F3F0] px-3 py-2.5 text-sm text-[#2D2118] outline-none transition focus:border-[#D49266] focus:ring-2 focus:ring-[#F5D2B8]"
        inputMode={inputMode}
        placeholder={placeholder}
      />
    </label>
  );
}

export function TextAreaField({
  label,
  ariaLabel,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="space-y-1.5 text-sm text-[#5C4B42]">
      <span className="font-medium">{label}</span>
      <textarea
        aria-label={ariaLabel ?? label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[92px] w-full rounded-xl border border-[#E8DCCF] bg-[#F7F3F0] px-3 py-2.5 text-sm text-[#2D2118] outline-none transition focus:border-[#D49266] focus:ring-2 focus:ring-[#F5D2B8]"
        placeholder={placeholder}
      />
    </label>
  );
}

export function SelectField({
  label,
  ariaLabel,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  ariaLabel?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="space-y-1.5 text-sm text-[#5C4B42]">
      <span className="font-medium">{label}</span>
      <select
        aria-label={ariaLabel ?? label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full rounded-xl border border-[#E8DCCF] bg-[#F7F3F0] px-3 py-2.5 text-sm text-[#2D2118] outline-none transition focus:border-[#D49266] focus:ring-2 focus:ring-[#F5D2B8] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RangeField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint: string;
}) {
  const numeric = Number.parseFloat(value);
  const safeValue = Number.isFinite(numeric) ? Math.min(Math.max(numeric, 0), 1) : 0;

  return (
    <label className="space-y-2 text-sm text-[#5C4B42]">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{label}</span>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold text-[#5B7A5C]">
          {(safeValue * 100).toFixed(0)}%
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        min="0"
        max="1"
        step="0.01"
        value={safeValue}
        onChange={(event) => onChange(event.target.value)}
        className="w-full accent-[#77A777]"
      />
      <p className="text-xs leading-5 text-[#6C7A6D]">{hint}</p>
    </label>
  );
}

export function PersistenceBanner() {
  return (
    <div className="rounded-2xl border border-[#F3C69B] bg-[#FFF1E3] px-4 py-3 text-sm font-medium text-[#9A5A2C]">
      💾 运行时持久化 — 所有配置修改在运行时即时生效，并自动持久化到 `.cat-cafe/cat-catalog.json` 文件
    </div>
  );
}
