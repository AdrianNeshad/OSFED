# OSFED

**Open Source Forensic Extraction Device** — a cross-platform (Windows / macOS / Linux) GUI
for reading iPhone/iPad extractions, either from an existing local backup folder or by
creating a fresh **encrypted** backup over a USB cable.

OSFED always creates *encrypted* backups, because the iOS keychain is only present in an
encrypted backup. Exploring the keychain is a first-class feature.

> Educational / authorized forensic use only. Only extract data from devices you own or are
> explicitly authorized to examine.

---

## What it does (current milestone)

- **Start flow** — detect a USB-connected device (via `libimobiledevice`) and run a full,
  always-encrypted backup, or open any local backup folder.
- **Overview** — device metadata (model, iOS, serial, IMEI, phone number), file/domain/app counts.
- **Keychain** 🔑 — decrypts and browses stored secrets (generic & internet passwords, keys,
  certificates) with per-item reveal/copy and raw-attribute inspection.
- **Timeline** — unified chronological view across messages, calls, photos, notes and Safari
  history, with type / date / text / contact filtering.
- **Data views** — Messages (chat bubbles), Call Log, Contacts, Notes, Safari History, Photos
  (metadata), Apps.
- **File Browser** — browse every file by domain and restore a domain (or the whole backup)
  to a folder.

## Architecture

```
Electron (window, IPC, dialogs, libimobiledevice control)
   │  spawns + newline-delimited JSON-RPC over stdio
   ▼
Go engine  (engine/)  — backup parsing, decryption, keychain, SQLite extraction
   ▲
   │  window.osfed bridge  (preload) → engineCall()
React + Vite + TypeScript renderer (src/)  — Phosphor-style grouped sidebar UI
```

- **UI**: Electron + React + TypeScript + Tailwind. Cross-platform via `electron-builder`.
- **Engine**: a single Go binary (`engine/`) that wraps a vendored copy of
  [`github.com/dunhamsteve/ios`](https://github.com/dunhamsteve/ios) (MIT) for backup parsing
  and keychain decryption, plus SQLite extractors for the content views.
- **Device backup**: the `libimobiledevice` CLI tools (`idevicebackup2`, `idevice_id`,
  `ideviceinfo`, `idevicepair`).

## Plug-and-play

The shipped app needs **nothing installed** to open backups, browse the keychain, view
the timeline, or parse content — the Go engine is a self-contained binary bundled in the app.

For **creating a backup from a connected device**, the libimobiledevice tools are bundled
*inside* the app too (macOS: binaries + their libraries, relinked to be self-contained), so
end users install nothing. Platform notes:

- **macOS** — fully plug-and-play. USB talks to the system `usbmuxd` that ships with macOS.
- **Windows** — still requires Apple's **Apple Devices** app (or iTunes) for the USB driver
  (`Apple Mobile Device Service`), exactly like every other tool of this kind.
- **Linux** — needs a running `usbmuxd` service (OSFED can ship and auto-start one).

## Credits

- Backup parsing & keychain decryption vendored from **dunhamsteve/ios** (`irestore`), MIT.
- Device backup via **libimobiledevice**.
- UX structure inspired by **Phosphor**; unified timeline inspired by **OpenExtract**.
