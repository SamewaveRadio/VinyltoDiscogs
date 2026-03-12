import { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AuthScreen from './screens/AuthScreen';
import QueueDashboard from './screens/QueueDashboard';
import NewRecordUpload from './screens/NewRecordUpload';
import ProcessingScreen from './screens/ProcessingScreen';
import MatchReview from './screens/MatchReview';
import NeedsReview from './screens/NeedsReview';
import Settings from './screens/Settings';
import Layout from './components/Layout';
import { Loader2 } from 'lucide-react';

type Screen = 'dashboard' | 'upload' | 'processing' | 'match-review' | 'needs-review' | 'settings';

function AppContent() {
  const { session, loading } = useAuth();
  const [currentScreen, setCurrentScreen] = useState<Screen>('dashboard');
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);

  const handleNavigate = (screen: Screen, recordId?: string) => {
    setCurrentScreen(screen);
    setActiveRecordId(recordId ?? null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-stone-400 animate-spin" />
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  const renderScreen = () => {
    switch (currentScreen) {
      case 'dashboard':
        return <QueueDashboard onNavigate={handleNavigate} />;
      case 'upload':
        return <NewRecordUpload onNavigate={handleNavigate} />;
      case 'processing':
        return <ProcessingScreen recordId={activeRecordId!} onNavigate={handleNavigate} />;
      case 'match-review':
        return <MatchReview onNavigate={handleNavigate} recordId={activeRecordId} />;
      case 'needs-review':
        return <NeedsReview onNavigate={handleNavigate} recordId={activeRecordId} />;
      case 'settings':
        return <Settings />;
      default:
        return <QueueDashboard onNavigate={handleNavigate} />;
    }
  };

  return (
    <Layout currentScreen={currentScreen} onNavigate={handleNavigate}>
      {renderScreen()}
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
