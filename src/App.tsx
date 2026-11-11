import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { ensureSeed } from './db';
import { monthOf, todayLocal, type MonthKey } from './lib/dates';
import type { ChargeLine } from './lib/types';
import { Analysis } from './ui/Analysis';
import { Dashboard } from './ui/Dashboard';
import { Import } from './ui/Import';
import { Settings } from './ui/Settings';
import { Transactions } from './ui/Transactions';
import { LoanOccurrenceForm, TxForm } from './ui/TxForm';
import { useData } from './ui/useData';

type Tab = 'dashboard' | 'analysis' | 'transactions' | 'import' | 'settings';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'דשבורד', icon: 'M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z' },
  { id: 'analysis', label: 'ניתוח', icon: 'M4 20V10m6 10V4m6 16v-7m4 7H2' },
  { id: 'transactions', label: 'עסקאות', icon: 'M4 6h16M4 12h16M4 18h10' },
  { id: 'import', label: 'ייבוא', icon: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3' },
  { id: 'settings', label: 'הגדרות', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14.5 2h-5l-.4 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2l.4 2.6h5l.4-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z' },
];

function readHash(): Tab {
  const h = location.hash.replace('#', '') as Tab;
  return TABS.some((t) => t.id === h) ? h : 'dashboard';
}

export default function App() {
  const data = useData();
  const [tab, setTab] = useState<Tab>(readHash);
  const [month, setMonth] = useState<MonthKey>(monthOf(todayLocal()));
  const [openLine, setOpenLine] = useState<ChargeLine | null>(null);
  const [newTx, setNewTx] = useState(false);
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  useEffect(() => {
    ensureSeed().catch(console.error);
    const onHash = () => setTab(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (t: Tab) => {
    location.hash = t;
    setTab(t);
    window.scrollTo(0, 0);
  };

  const openTx = openLine?.kind === 'transaction' ? data.transactions.find((t) => t.id === openLine.refId) : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <h1>{TABS.find((t) => t.id === tab)?.label}</h1>
      </header>
      {needRefresh && (
        <div className="update-bar">
          יש גרסה חדשה של האפליקציה
          <button className="btn small" onClick={() => updateServiceWorker(true)}>עדכון</button>
        </div>
      )}
      <main>
        {!data.ready ? (
          <div className="page"><p className="muted">טוען…</p></div>
        ) : (
          <>
            {tab === 'dashboard' && <Dashboard data={data} month={month} setMonth={setMonth} onOpenLine={setOpenLine} />}
            {tab === 'analysis' && <Analysis data={data} />}
            {tab === 'transactions' && <Transactions data={data} month={month} setMonth={setMonth} onOpenLine={setOpenLine} onNew={() => setNewTx(true)} />}
            {tab === 'import' && <Import data={data} goSettings={() => go('settings')} />}
            {tab === 'settings' && <Settings data={data} />}
          </>
        )}
      </main>
      <nav className="tabbar" aria-label="ניווט">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => go(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={t.icon} /></svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      {openTx && <TxForm data={data} existing={openTx} onClose={() => setOpenLine(null)} />}
      {openLine?.kind === 'loan' && <LoanOccurrenceForm data={data} line={openLine} onClose={() => setOpenLine(null)} />}
      {newTx && <TxForm data={data} onClose={() => setNewTx(false)} />}
    </div>
  );
}
