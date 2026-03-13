import { ReactNode } from 'react';
import { LayoutGrid, Upload, GitMerge, AlertTriangle, Settings as SettingsIcon, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Screen = 'dashboard' | 'upload' | 'processing' | 'match-review' | 'needs-review' | 'settings';

interface LayoutProps {
  children: ReactNode;
  currentScreen: Screen;
  onNavigate: (screen: Screen) => void;
}

const NAV_ITEMS: { screen: Screen; label: string; icon: React.ElementType }[] = [
  { screen: 'dashboard',    label: 'Queue',    icon: LayoutGrid },
  { screen: 'upload',       label: 'New',      icon: Upload },
  { screen: 'match-review', label: 'Matches',  icon: GitMerge },
  { screen: 'needs-review', label: 'Review',   icon: AlertTriangle },
  { screen: 'settings',     label: 'Settings', icon: SettingsIcon },
];

export default function Layout({ children, currentScreen, onNavigate }: LayoutProps) {
  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="flex flex-col min-h-screen min-h-[100dvh] bg-white lg:flex-row">
      <aside className="hidden lg:flex w-44 shrink-0 border-r border-black flex-col">
        <div className="border-b border-black px-4 py-4">
          <p className="text-[9px] font-semibold uppercase tracking-[0.3em] text-black">V2D</p>
        </div>

        <nav className="flex-1 py-2">
          {NAV_ITEMS.map(({ screen, label, icon: Icon }) => {
            const active = currentScreen === screen;
            return (
              <button
                key={screen}
                onClick={() => onNavigate(screen)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  active
                    ? 'bg-black text-white'
                    : 'text-neutral-500 hover:text-black hover:bg-neutral-50'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="text-[10px] font-medium uppercase tracking-widest">{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-black">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-3 text-neutral-400 hover:text-black hover:bg-neutral-50 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span className="text-[10px] font-medium uppercase tracking-widest">Sign Out</span>
          </button>
        </div>
      </aside>

      <div className="lg:hidden flex items-center justify-between border-b border-black px-4 py-3">
        <p className="text-[9px] font-semibold uppercase tracking-[0.3em] text-black">V2D</p>
        <button
          onClick={handleSignOut}
          className="text-neutral-400 hover:text-black transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>

      <main className="flex-1 min-w-0 overflow-auto pb-16 lg:pb-0">
        {children}
      </main>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-black flex z-50">
        {NAV_ITEMS.map(({ screen, label, icon: Icon }) => {
          const active = currentScreen === screen;
          return (
            <button
              key={screen}
              onClick={() => onNavigate(screen)}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors ${
                active
                  ? 'bg-black text-white'
                  : 'text-neutral-400 active:bg-neutral-100'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[8px] font-medium uppercase tracking-wider">{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
