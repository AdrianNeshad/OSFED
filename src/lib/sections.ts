import {
  Smartphone,
  LayoutDashboard,
  KeyRound,
  Clock,
  MessageSquare,
  PhoneCall,
  Users,
  Image,
  StickyNote,
  Compass,
  Grid3x3,
  FolderTree,
  type LucideIcon,
} from 'lucide-react';

export type SectionId =
  | 'start'
  | 'overview'
  | 'timeline'
  | 'keychain'
  | 'messages'
  | 'calls'
  | 'contacts'
  | 'photos'
  | 'notes'
  | 'safari'
  | 'apps'
  | 'files';

export type SectionGroup = 'Device' | 'Analysis' | 'Data' | 'Tools';

export interface SectionDef {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  group: SectionGroup;
  /** Requires an opened backup to be useful. */
  needsBackup: boolean;
}

export const SECTIONS: SectionDef[] = [
  { id: 'start', label: 'Start', icon: Smartphone, group: 'Device', needsBackup: false },
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'Device', needsBackup: true },

  { id: 'timeline', label: 'Timeline', icon: Clock, group: 'Analysis', needsBackup: true },
  { id: 'keychain', label: 'Keychain', icon: KeyRound, group: 'Analysis', needsBackup: true },

  { id: 'messages', label: 'Messages', icon: MessageSquare, group: 'Data', needsBackup: true },
  { id: 'calls', label: 'Call Log', icon: PhoneCall, group: 'Data', needsBackup: true },
  { id: 'contacts', label: 'Contacts', icon: Users, group: 'Data', needsBackup: true },
  { id: 'photos', label: 'Photos', icon: Image, group: 'Data', needsBackup: true },
  { id: 'notes', label: 'Notes', icon: StickyNote, group: 'Data', needsBackup: true },
  { id: 'safari', label: 'Safari', icon: Compass, group: 'Data', needsBackup: true },
  { id: 'apps', label: 'Apps', icon: Grid3x3, group: 'Data', needsBackup: true },

  { id: 'files', label: 'File Browser', icon: FolderTree, group: 'Tools', needsBackup: true },
];

export const GROUP_ORDER: SectionGroup[] = ['Device', 'Analysis', 'Data', 'Tools'];
