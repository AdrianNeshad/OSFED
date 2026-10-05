package backup

import (
	"fmt"
	"os"
	"path"

	"github.com/dunhamsteve/ios/keybag"
	"github.com/dunhamsteve/plist"
)

// osfedStringMap normalizes the two shapes kvarchive can return for a file
// record (map[string]interface{} or map[interface{}]interface{}) into a map
// with string keys.
func osfedStringMap(v interface{}) map[string]interface{} {
	switch m := v.(type) {
	case map[string]interface{}:
		return m
	case map[interface{}]interface{}:
		out := make(map[string]interface{}, len(m))
		for k, val := range m {
			out[fmt.Sprintf("%v", k)] = val
		}
		return out
	default:
		return map[string]interface{}{}
	}
}

// osfedInt coerces the numeric variants archivers emit into int64.
func osfedInt(v interface{}) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case uint64:
		return int64(n)
	case float64:
		return int64(n)
	case float32:
		return int64(n)
	default:
		return 0
	}
}

func osfedBytes(v interface{}) []byte {
	if b, ok := v.([]byte); ok {
		return b
	}
	return nil
}

func osfedStr(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// OpenDir opens a MobileBackup located at an arbitrary directory path.
//
// Unlike Open, which resolves a backup GUID against the platform default
// MobileSync location, OpenDir accepts the full path to a backup folder (the
// directory that directly contains Manifest.plist / Manifest.db). This is what
// OSFED needs when the user points at a local-backup folder anywhere on disk,
// including the folder idevicebackup2 just wrote.
func OpenDir(dir string) (*MobileBackup, error) {
	var mb MobileBackup
	mb.Dir = dir

	r, err := os.Open(path.Join(dir, "Manifest.plist"))
	if err != nil {
		return nil, err
	}
	defer r.Close()
	if err := plist.Unmarshal(r, &mb.Manifest); err != nil {
		return nil, err
	}
	mb.Keybag = keybag.Read(mb.Manifest.BackupKeyBag)
	return &mb, nil
}

// EnumerateDir lists the backups found directly under an arbitrary root
// directory (each subfolder containing a Manifest.plist). The returned
// Backup.FileName is the absolute path to the backup folder so it can be
// handed straight to OpenDir.
func EnumerateDir(root string) ([]Backup, error) {
	r, err := os.Open(root)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	infos, err := r.Readdir(-1)
	if err != nil {
		return nil, err
	}

	var all []Backup
	for _, fi := range infos {
		if !fi.IsDir() {
			continue
		}
		full := path.Join(root, fi.Name())
		pr, err := os.Open(path.Join(full, "Manifest.plist"))
		if err != nil {
			continue
		}
		var manifest Manifest
		err = plist.Unmarshal(pr, &manifest)
		pr.Close()
		if err != nil {
			continue
		}
		all = append(all, Backup{manifest.Lockdown.DeviceName, full})
	}
	return all, nil
}
