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
  { screen: 'dashboard',    label: 'Queue',         icon: LayoutGrid },
  { screen: 'upload',       label: 'New Record',    icon: Upload },
  { screen: 'match-review', label: 'Match Review',  icon: GitMerge },
  { screen: 'needs-review', label: 'Needs Review',  icon: AlertTriangle },
  { screen: 'settings',     label: 'Settings',      icon: SettingsIcon },
];

export default function Layout({ children, currentScreen, onNavigate }: LayoutProps) {
  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="flex min-h-screen bg-white">
      <aside className="w-44 shrink-0 border-r border-black flex flex-col">
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

      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  );
}
