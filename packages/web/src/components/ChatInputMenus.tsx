'use client';

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { type CatOption, MODE_OPTIONS } from './chat-input-options';

interface ChatInputMenusProps {
  catOptions: CatOption[];
  showMentions: boolean;
  showModeMenu: boolean;
  selectedIdx: number;
  onSelectIdx: (i: number) => void;
  onInsertMention: (opt: CatOption) => void;
  onInsertOption: (text: string) => void;
  menuRef: RefObject<HTMLDivElement>;
}

export function ChatInputMenus({
  catOptions,
  showMentions,
  showModeMenu,
  selectedIdx,
  onSelectIdx,
  onInsertMention,
  onInsertOption,
  menuRef,
}: ChatInputMenusProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);

  // Auto-scroll selected item into view on keyboard navigation
  const selectedRef = useCallback((node: HTMLButtonElement | null) => {
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
  }, []);

  // Detect if more items are hidden below
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      setCanScrollDown(false);
      return;
    }
    const check = () => setCanScrollDown(el.scrollHeight > el.clientHeight + el.scrollTop + 4);
    check();
    el.addEventListener('scroll', check);
    return () => el.removeEventListener('scroll', check);
  }, []);

  return (
    <>
      {showMentions && (
        <div
          ref={menuRef}
          className="absolute bottom-full left-4 mb-2 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden w-64 z-10 max-h-80 flex flex-col"
        >
          <div ref={scrollRef} className="overflow-y-auto flex-1">
            {catOptions.map((opt, i) => (
              <button
                key={opt.id}
                ref={i === selectedIdx ? selectedRef : undefined}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${i === selectedIdx ? 'bg-gray-50' : 'hover:bg-gray-50'}`}
                onMouseEnter={() => onSelectIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onInsertMention(opt);
                }}
              >
                <img
                  src={opt.avatar}
                  alt={opt.label}
                  className="w-7 h-7 rounded-full"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
                <div>
                  <div className="text-sm font-semibold" style={{ color: opt.color }}>
                    {opt.label}
                  </div>
                  <div className="text-xs text-gray-400">{opt.desc}</div>
                </div>
              </button>
            ))}
          </div>
          {canScrollDown && (
            <div className="px-4 py-1 text-[10px] text-gray-400 text-center border-t border-gray-100 bg-gradient-to-t from-white shrink-0">
              ↓ 还有更多猫猫
            </div>
          )}
          {catOptions.length === 0 && <div className="px-4 py-2.5 text-xs text-gray-400">无匹配猫猫</div>}
          <div className="px-4 py-1.5 text-xs text-gray-300 border-t border-gray-100 shrink-0">
            {'\u2191\u2193 \u9009\u62E9 \u00B7 Enter \u786E\u8BA4 \u00B7 Esc \u5173\u95ED'}
          </div>
        </div>
      )}

      {showModeMenu && (
        <div
          ref={menuRef}
          className="absolute bottom-full left-4 mb-2 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden w-72 z-10"
        >
          {MODE_OPTIONS.map((opt, i) => (
            <button
              key={opt.id}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${i === selectedIdx ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
              onMouseEnter={() => onSelectIdx(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onInsertOption(opt.insert);
              }}
            >
              <span className="text-lg w-7 text-center">{opt.icon}</span>
              <div>
                <div className="text-sm font-semibold text-gray-700">{opt.label}</div>
                <div className="text-xs text-gray-400 font-mono">{opt.desc}</div>
              </div>
            </button>
          ))}
          <div className="px-4 py-1.5 text-xs text-gray-300 border-t border-gray-100">
            {'\u2191\u2193 \u9009\u62E9 \u00B7 Enter \u786E\u8BA4 \u00B7 Esc \u5173\u95ED'}
          </div>
        </div>
      )}
    </>
  );
}
