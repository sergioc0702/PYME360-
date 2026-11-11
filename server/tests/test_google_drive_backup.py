"""The uploader must reject an unverified Drive response."""

import hashlib
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    from googleapiclient.http import MediaIoBaseUpload
except ImportError:
    MediaIoBaseUpload = None

from google_drive_backup import DRIVE_SCOPE, prune_uploads, upload_encrypted  # noqa: E402


class FakeFiles:
    def __init__(self, mismatch=False):
        self.mismatch = mismatch
        self.received = None

    def create(self, *, body, media_body, fields):
        self.received = (body, media_body, fields)
        return self

    def execute(self):
        body, media, _ = self.received
        data = media.getbytes(0, media.size())
        return {
            "id": "drive-file-1", "name": body["name"], "size": str(len(data)),
            "md5Checksum": "bad" if self.mismatch else hashlib.md5(data).hexdigest(),
        }


class FakeService:
    def __init__(self, mismatch=False):
        self.files_api = FakeFiles(mismatch)

    def files(self):
        return self.files_api


@unittest.skipUnless(MediaIoBaseUpload, "Requiere dependencias opcionales de Google Drive")
class GoogleDriveBackupTests(unittest.TestCase):
    def test_upload_uses_only_app_created_files_and_verifies_remote_content(self):
        self.assertEqual(DRIVE_SCOPE, "https://www.googleapis.com/auth/drive.file")
        service = FakeService()
        result = upload_encrypted(service, '{"format":"pyme360-encrypted-backup"}')
        self.assertEqual(result["id"], "drive-file-1")
        metadata, media, fields = service.files_api.received
        self.assertTrue(metadata["name"].startswith("pyme360-respaldo-"))
        self.assertEqual(media.mimetype(), "application/json")
        self.assertIn("md5Checksum", fields)
        with self.assertRaisesRegex(RuntimeError, "no confirmó"):
            upload_encrypted(FakeService(mismatch=True), '{"format":"pyme360-encrypted-backup"}')


class ListingFiles:
    def __init__(self, names):
        self.files_data = [{"id": f"id-{index}", "name": name} for index, name in enumerate(names)]
        self.deleted = []
        self.pending = None

    def list(self, **query):
        self.query = query
        self.pending = {"files": self.files_data}
        return self

    def delete(self, *, fileId):
        self.deleted.append(fileId)
        self.pending = {}
        return self

    def execute(self):
        return self.pending


class ListingService:
    def __init__(self, names):
        self.api = ListingFiles(names)

    def files(self):
        return self.api


class GoogleDriveRetentionTests(unittest.TestCase):
    def test_old_copies_are_deleted_and_unrelated_files_are_ignored(self):
        names = [f"pyme360-respaldo-2026-11-{day:02d}.json" for day in range(31, 0, -1)] + ["otro.json"]
        service = ListingService(names)
        removed = prune_uploads(service, keep=30)
        self.assertEqual(removed, ["id-30"])
        self.assertEqual(service.api.query["orderBy"], "createdTime desc")
        self.assertIn("trashed = false", service.api.query["q"])
