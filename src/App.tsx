import { useState, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import type { SectionId } from './lib/sections';
import type { BackupInfo } from './lib/types';

import StartSection from './sections/StartSection';
import OverviewSection from './sections/OverviewSection';
import KeychainSection from './sections/KeychainSection';
import FilesSection from './sections/FilesSection';
import TimelineSection from './sections/TimelineSection';
import MessagesSection from './sections/MessagesSection';
import CallsSection from './sections/CallsSection';
import ContactsSection from './sections/ContactsSection';
import PhotosSection from './sections/PhotosSection';
import NotesSection from './sections/NotesSection';
import SafariSection from './sections/SafariSection';
import AppsSection from './sections/AppsSection';

export default function App() {
  const [section, setSection] = useState<SectionId>('start');
  const [backup, setBackup] = useState<BackupInfo | null>(null);

  const openBackup = useCallback((info: BackupInfo) => {
    setBackup(info);
    setSection('overview');
  }, []);

  const closeBackup = useCallback(() => {
    if (backup) window.osfed.call('close_backup', { handle: backup.handle }).catch(() => {});
    setBackup(null);
    setSection('start');
  }, [backup]);

  const handle = backup?.handle ?? '';

  return (
    <div className="flex h-full w-full">
      <Sidebar current={section} onSelect={setSection} backup={backup} />
      <main className="flex-1 h-full overflow-hidden bg-base">
        {section === 'start' && (
          <StartSection backup={backup} onOpened={openBackup} onClose={closeBackup} />
        )}
        {section === 'overview' && backup && (
          <OverviewSection backup={backup} onNavigate={setSection} onClose={closeBackup} />
        )}
        {section === 'keychain' && backup && <KeychainSection handle={handle} />}
        {section === 'timeline' && backup && <TimelineSection handle={handle} />}
        {section === 'messages' && backup && <MessagesSection handle={handle} />}
        {section === 'calls' && backup && <CallsSection handle={handle} />}
        {section === 'contacts' && backup && <ContactsSection handle={handle} />}
        {section === 'photos' && backup && <PhotosSection handle={handle} />}
        {section === 'notes' && backup && <NotesSection handle={handle} />}
        {section === 'safari' && backup && <SafariSection handle={handle} />}
        {section === 'apps' && backup && <AppsSection backup={backup} />}
        {section === 'files' && backup && <FilesSection handle={handle} />}
      </main>
    </div>
  );
}
